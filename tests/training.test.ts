import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  createTrainingPlan,
  planKm,
  stepMeters,
  stepSeconds,
  volumeMilestones,
  garminWorkoutText,
} from "../src/shared/training-plan";
import {
  weeklyMetrics,
  comparableRuns,
  sportGroup,
} from "../src/server/training/metrics";
import { assessProgression } from "../src/server/training/progression";
import { workoutCompletion } from "../src/server/training/dashboard";
import { TrainingRepository } from "../src/server/training/repository";
import { migrateDatabase } from "../src/server/db/migrate";
import {
  checkInSchema,
  planSettingsSchema,
} from "../src/server/training/validation";
import { authorizeMutation } from "../src/server/security/authorize";
import type {
  ActivityMeasurement,
  DailyCheckIn,
} from "../src/shared/types/metrics";

function activity(
  id: string,
  day: string,
  km = 5,
  seconds = 1800,
  type = "running",
): ActivityMeasurement {
  return {
    id,
    name: type === "indoor_cardio" ? "HYROX" : null,
    sportType: type,
    startedAt: `${day}T12:00:00Z`,
    durationSeconds: seconds,
    distanceMeters: km * 1000,
    averageHeartRate: 145,
    rawJson: JSON.stringify({
      elevationGain: 50,
      startLatitude: 41.34,
      startLongitude: -8.48,
      minTemperature: 20,
      maxTemperature: 24,
    }),
  };
}
test("all 30 plan totals come from nested steps and stay consistent when planning pace changes", () => {
  for (let stage = 1; stage <= 30; stage++)
    for (const easy of [300, 375, 480]) {
      const p = createTrainingPlan(stage, "2026-10-26", easy, 270);
      assert(Math.abs(planKm(p) - volumeMilestones[stage - 1]) < 0.000001);
      assert.equal(
        p.workouts.filter((w) => w.type === "quality").length,
        stage % 4 === 0 ? 0 : 1,
      );
      assert.equal(
        p.workouts.some((w) => w.dayOffset === 6),
        false,
      );
      assert(
        p.workouts.every((w) => w.steps.every((s) => stepMeters(s, easy) > 0)),
      );
      assert.equal(
        p.workouts.length,
        volumeMilestones[stage - 1] < 40
          ? 4
          : volumeMilestones[stage - 1] < 60
            ? 5
            : 6,
      );
    }
  const strides = createTrainingPlan(1, "2026-10-26").workouts.find(
    (w) => w.type === "strides",
  )!;
  const repeat = strides.steps.find((s) => s.kind === "repeat")!;
  assert.equal(stepSeconds(repeat, 375), 720);
  assert(
    Math.abs(stepMeters(repeat, 375) - 6 * (20 / 255 + 100 / 412.5) * 1000) <
      0.001,
  );
  const text = garminWorkoutText(strides);
  assert(text.includes("Repeat 6 times"));
  assert(text.includes("Recover — 1:40 — Pace 6:15–7:30/km"));
  assert.throws(() => createTrainingPlan(31, "2026-10-26"), /Invalid/);
  const adjusted = createTrainingPlan(2, "2026-11-02", 375, 270, 26.3);
  assert(Math.abs(planKm(adjusted) - 26.3) < 0.000001);
  assert.throws(
    () => createTrainingPlan(1, "2026-11-02", 375, 270, 80),
    /Reviewed volume/,
  );
});

test("calendar weeks, sport classification and wellness separation include zero weeks", () => {
  const rows = [
    activity("run", "2026-10-28"),
    activity("hyrox", "2026-10-28", 0, 3600, "indoor_cardio"),
    activity("ride", "2026-10-27", 30, 3600, "virtual_ride"),
    activity("wellness", "2026-10-26", 0, 600, "meditation"),
    activity("prior", "2026-10-25", 8),
    activity("future", "2026-11-02", 99),
  ];
  const weeks = weeklyMetrics(rows, new Date("2026-10-29T12:00:00Z"));
  assert.equal(weeks.length, 5);
  assert.equal(weeks[0].runningKm, 0);
  const last = weeks.at(-1)!;
  assert.equal(last.start, "2026-10-26");
  assert.equal(last.partial, true);
  assert.equal(last.runningKm, 5);
  assert.equal(last.runningMinutes, 30);
  assert.equal(last.hyroxMinutes, 60);
  assert.equal(last.cyclingMinutes, 60);
  assert.equal(last.wellnessMinutes, 10);
  assert.equal(weeks.at(-2)!.runningKm, 8);
  assert.equal(
    sportGroup({
      ...rows[0],
      sportType: "strength_training",
      name: "Strength",
    }),
    "other",
  );
});

test("pace comparisons require three independent comparable pairs and reject missing terrain or different HR", () => {
  const old = Array.from({ length: 3 }, (_, i) =>
    activity(`old${i}`, `2026-09-${10 + i}`, 5, 1800),
  );
  const recent = Array.from({ length: 3 }, (_, i) =>
    activity(`new${i}`, `2026-10-${10 + i}`, 5, 1750),
  );
  const now = new Date("2026-10-29T12:00:00Z");
  const trend = comparableRuns([...old, ...recent], now);
  assert.equal(trend.pairs, 3);
  assert.equal(trend.secondsPerKmChange, -10);
  assert.equal(
    comparableRuns([...old.slice(0, 1), ...recent], now).secondsPerKmChange,
    null,
  );
  assert.equal(
    comparableRuns(
      [...old, ...recent.map((a) => ({ ...a, averageHeartRate: 150 }))],
      now,
    ).pairs,
    0,
  );
  assert.equal(
    comparableRuns(
      [...old, ...recent.map((a) => ({ ...a, rawJson: "{}" }))],
      now,
    ).pairs,
    0,
  );
  assert.equal(
    comparableRuns(
      [...old, ...recent.map((a) => ({ ...a, sportType: "trail_running" }))],
      now,
    ).pairs,
    0,
  );
});

test("check-ins upsert once per day and saved plan snapshots retain reviewed steps", () => {
  const db = new Database(":memory:");
  try {
    migrateDatabase(db);
    migrateDatabase(db);
    const repo = new TrainingRepository(db);
    repo.saveCheckIn({
      day: "2026-10-29",
      fatigue: 2,
      soreness: 1,
      pain: 0,
      notes: "Fine",
    });
    repo.saveCheckIn({
      day: "2026-10-29",
      fatigue: 4,
      soreness: 3,
      pain: 1,
      notes: "Updated",
    });
    assert.equal(repo.checkIns().length, 1);
    assert.equal(repo.checkIns()[0].fatigue, 4);
    const plan = createTrainingPlan(1, "2026-10-26");
    plan.workouts[0].title = "Reviewed workout";
    repo.savePlan(plan);
    assert.equal(repo.plans()[0].workouts[0].title, "Reviewed workout");
    assert.equal(planKm(repo.plans()[0]), planKm(plan));
    repo.savePlan(plan);
    assert.equal(repo.plans().length, 1);
  } finally {
    db.close();
  }
});

test("distance completion groups runs by date and does not mark partial or future sessions complete", () => {
  const plan = createTrainingPlan(1, "2026-10-26");
  const rows = [
    activity("one", "2026-10-26", 2),
    activity("two", "2026-10-26", 2),
    activity("partial", "2026-10-27", 1),
  ];
  const completion = workoutCompletion(plan, rows, "2026-10-29");
  assert.equal(completion[0].status, "distance met");
  assert.equal(completion[1].status, "partial");
  assert.equal(completion.at(-1)!.status, "planned");
  assert.equal(
    workoutCompletion(plan, [], "2026-11-02")[0].status,
    "not recorded",
  );
});

function progressionFixture() {
  const now = new Date("2026-10-26T12:00:00Z");
  const activities = [
    activity("m", "2026-10-19", 6),
    activity("t", "2026-10-20", 5),
    activity("th", "2026-10-22", 5),
    activity("sat", "2026-10-24", 9),
  ];
  const checkIns: DailyCheckIn[] = [24, 25, 26].map((n) => ({
    day: `2026-10-${n}`,
    fatigue: 1,
    soreness: 1,
    pain: 0,
    notes: "",
  }));
  return {
    now,
    plans: [createTrainingPlan(1, "2026-10-19")],
    weeks: weeklyMetrics(activities, now),
    activities,
    checkIns,
    lastSync: now.toISOString(),
  };
}
test("progression requires a finished week, fresh sync, adherence and recovery evidence", () => {
  const input = progressionFixture();
  assert.equal(assessProgression(input).decision, "increase");
  assert.equal(assessProgression(input).suggestedKm, 26.3);
  assert.equal(assessProgression({ ...input, checkIns: [] }).decision, "hold");
  assert.equal(
    assessProgression({ ...input, lastSync: null }).decision,
    "hold",
  );
  assert.equal(
    assessProgression({
      ...input,
      plans: [createTrainingPlan(1, "2026-10-26")],
    }).decision,
    "hold",
  );
  const reduced = weeklyMetrics(
    input.activities.map((a) => ({ ...a, distanceMeters: 1000 })),
    input.now,
  );
  assert.equal(
    assessProgression({ ...input, weeks: reduced }).decision,
    "hold",
  );
  assert.equal(
    assessProgression({
      ...input,
      checkIns: input.checkIns.map((c) => ({ ...c, pain: 1 })),
    }).decision,
    "reduce",
  );
  assert.equal(
    assessProgression({
      ...input,
      checkIns: input.checkIns.map((c) => ({ ...c, fatigue: 4 })),
    }).decision,
    "reduce",
  );
});

test("payload validation rejects invalid scores, paces and non-Monday starts", () => {
  assert(
    !checkInSchema.safeParse({
      day: "2026-10-29",
      fatigue: 0,
      soreness: 1,
      pain: 0,
    }).success,
  );
  assert(
    !checkInSchema.safeParse({
      day: "2026-10-29",
      fatigue: 1,
      soreness: 1,
      pain: 11,
    }).success,
  );
  assert(
    !planSettingsSchema.safeParse({
      weekNumber: 1,
      start: "2026-10-29",
      easyPace: 375,
      tempoPace: 270,
    }).success,
  );
  assert(
    !planSettingsSchema.safeParse({
      weekNumber: 1,
      start: "2026-10-26",
      easyPace: 0,
      tempoPace: 270,
    }).success,
  );
});

test("recovery reviews flag combined-sport growth, long-run jumps and scheduled cutbacks", () => {
  const input = progressionFixture();
  const weeks = input.weeks.map((w) => ({
    ...w,
    cyclingMinutes: w.start === "2026-10-19" ? 300 : 30,
  }));
  const competing = assessProgression({ ...input, weeks });
  assert.equal(competing.decision, "hold");
  assert(competing.reasons[0].includes("combined workload"));
  const shortRuns = input.activities.flatMap((a, i) => [
    { ...a, id: `short${i}a`, distanceMeters: 3000 },
    { ...a, id: `short${i}b`, distanceMeters: 3250 },
  ]);
  const jump = assessProgression({ ...input, activities: shortRuns });
  assert.equal(jump.decision, "hold");
  assert(jump.reasons[0].includes("longest run"));
  const cutback = assessProgression({
    ...input,
    plans: [createTrainingPlan(3, "2026-10-19")],
    weeks: input.weeks.map((w) =>
      w.start === "2026-10-19" ? { ...w, runningKm: 29 } : w,
    ),
  });
  assert.equal(cutback.decision, "reduce");
  assert.equal(cutback.suggestedKm, 23);
});

test("training writes use the same authorization and origin protections as Garmin sync", () => {
  const original = process.env.SYNC_SECRET;
  process.env.SYNC_SECRET = "fixture-passphrase-long-enough";
  try {
    assert.equal(
      authorizeMutation(
        new Request("http://localhost/api/training/check-in", {
          method: "POST",
        }),
      )?.status,
      401,
    );
    assert.equal(
      authorizeMutation(
        new Request("http://localhost/api/training/check-in", {
          method: "POST",
          headers: {
            "x-sync-secret": process.env.SYNC_SECRET,
            origin: "https://elsewhere.test",
          },
        }),
      )?.status,
      403,
    );
    assert.equal(
      authorizeMutation(
        new Request("http://localhost/api/training/check-in", {
          method: "POST",
          headers: {
            "x-sync-secret": process.env.SYNC_SECRET,
            origin: "http://localhost",
          },
        }),
      ),
      null,
    );
  } finally {
    if (original === undefined) delete process.env.SYNC_SECRET;
    else process.env.SYNC_SECRET = original;
  }
});
