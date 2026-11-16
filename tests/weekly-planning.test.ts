import { saveReviewedPlan } from "../src/server/training/save-plan";
import { calendarMileage } from "../src/shared/mileage";
import { trainingCalendar } from "../src/server/training/calendar";
import { GarminRepository } from "../src/server/db/garmin-repository";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/server/db/migrate";
import { TrainingRepository } from "../src/server/training/repository";
import { ScheduleRepository } from "../src/server/training/schedule-repository";
import { CommitmentRepository } from "../src/server/training/commitment-repository";
import {
  weeklyPlanning,
  fingerprint,
} from "../src/server/training/weekly-planning";
import {
  WeeklyPlanner,
  acceptPreparedWeek,
  weeklyModelContext,
} from "../src/server/coach/weekly";
import { DEFAULT_WEEK_PREFERENCES } from "../src/shared/types/schedule";
import { createTrainingPlan, workoutKm } from "../src/shared/training-plan";
import { shiftDay } from "../src/server/training/dates";
import { coachContext } from "../src/server/coach/context";
import { randomUUID } from "node:crypto";

const now = new Date("2026-11-09T10:00:00Z"),
  start = "2026-11-09";
function fixture(t: TestContext) {
  const db = new Database(":memory:");
  migrateDatabase(db);
  t.after(() => db.close());
  const repo = new TrainingRepository(db),
    schedule = new ScheduleRepository(db);
  repo.savePlan(createTrainingPlan(1, "2026-11-02"), now);
  schedule.saveWeek("2026-11-02", {
    ...structuredClone(DEFAULT_WEEK_PREFERENCES),
    hyrox: { monday: "going", wednesday: "going", friday: "skipping" },
  });
  db.prepare(
    "INSERT INTO sync_state(provider,last_completed_at,updated_at) VALUES('garmin',?,?)",
  ).run(now.toISOString(), now.toISOString());
  const activity = (day: string, km: number, sport = "running") => {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO activities(id,provider_activity_id,sport_type,name,started_at,duration_seconds,distance_meters,average_heart_rate,raw_json,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      id,
      sport,
      "PRIVATE ACTIVITY",
      day + "T08:00:00Z",
      sport === "running" ? km * 375 : 3600,
      km * 1000,
      145,
      JSON.stringify({
        startLatitude: 123,
        startLongitude: 456,
        elevationGain: 10,
        minTemperature: 15,
        maxTemperature: 15,
        aerobicTrainingEffect: 2.5,
        activityTrainingLoad: 50,
        secret: "PRIVATE RAW",
      }),
      now.toISOString(),
    );
  };
  for (let week = 0; week < 4; week++) {
    const monday = shiftDay("2026-11-02", -7 * week);
    for (const [day, km] of [
      [0, 5.3],
      [1, 5.7],
      [3, 6.7],
      [5, 8.3],
    ])
      activity(shiftDay(monday, day), km);
    activity(monday, 0, "cycling");
    activity(shiftDay(monday, 2), 0, "hyrox");
  }
  for (let i = 1; i <= 28; i++)
    db.prepare(
      "INSERT INTO daily_health(id,day,sleep_seconds,resting_heart_rate,body_battery,raw_json,imported_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      String(i),
      shiftDay(start, -i),
      8 * 3600,
      i <= 3 ? 51 : 50,
      40,
      "{}",
      now.toISOString(),
    );
  return { db, repo, schedule, activity };
}
function worker(
  db: Database.Database,
  choice = "recommended",
  onCall = () => {},
  reason = "local_recommendation",
) {
  return new WeeklyPlanner(
    db,
    async () => {
      onCall();
      return {
        output: {
          choice,
          reason,
          summary: "Review the prepared stage using completed Garmin training.",
          observations: ["Daily recovery reporting is optional."],
        },
        inputTokens: 1,
        outputTokens: 1,
      };
    },
    true,
    () => now,
  );
}

test("completed Stage 1 prepares this Monday at Stage 2 without check-ins or RPE logs", (t) => {
  const f = fixture(t),
    before = f.db.serialize(),
    p = weeklyPlanning(f.db, now);
  assert.equal(p.start, start);
  assert.equal(p.reference?.stage, 1);
  assert.equal(p.reference?.recordedKm.toFixed(2), "26.00");
  assert.equal(p.selected.plan.weekNumber, 2);
  assert(p.selected.plan.targetKm > 25 && p.selected.plan.targetKm <= 27);
  assert.equal(p.recovery.status, "supportive");
  assert.equal(p.history.ratedCoverage, 0);
  assert.equal(p.history.sessions.length, 6);
  assert.equal(p.history.weeks.length, 4);
  assert.deepEqual(f.db.serialize(), before);
  assert.equal(f.repo.plans().length, 1);
  assert.equal(p.selected.preferences.hyrox.friday, "skipping");
  for (const run of p.selected.plan.workouts)
    assert(workoutKm(run, p.selected.plan.easyPace) >= 5);
});

test("one approval atomically saves the exact prepared week and inherited attendance, and is idempotent", (t) => {
  const f = fixture(t),
    p = weeklyPlanning(f.db, now),
    original = f.repo.plans()[0];
  const result = acceptPreparedWeek(f.db, p.token, now);
  assert.equal(result.saved, true);
  assert.equal(f.repo.plans().length, 2);
  assert.equal(
    fingerprint(f.repo.plans().find((p) => p.start === start)),
    fingerprint(p.selected.plan),
  );
  assert.equal(
    fingerprint(f.repo.plans().find((p) => p.start === original.start)),
    fingerprint(original),
  );
  assert.deepEqual(f.schedule.week(start), p.selected.preferences);
  assert.equal(weeklyPlanning(f.db, now).needsApproval, false);
  assert.equal(acceptPreparedWeek(f.db, p.token, now).saved, true);
  assert.equal(f.repo.checkIns().length, 0);
});

test("an incomplete week repeats the saved stage instead of inventing progression or catch-up runs", (t) => {
  const f = fixture(t);
  f.db.prepare("DELETE FROM activities WHERE started_at>=?").run("2026-11-02");
  const p = weeklyPlanning(f.db, now);
  assert.equal(p.selected.plan.weekNumber, 2);
  assert(p.selected.plan.targetKm <= 25);
  assert.equal(
    p.selected.plan.workouts.some((w) => w.dayOffset === 6),
    false,
  );
});

test("missing recovery sensors permit approval of a steady week without daily reports", (t) => {
  const f = fixture(t);
  f.db.prepare("DELETE FROM daily_health").run();
  const p = weeklyPlanning(f.db, now);
  assert.equal(p.recovery.status, "unknown");
  assert.equal(p.selected.plan.weekNumber, 2);
  assert.equal(p.selected.plan.targetKm, 27);
  assert.equal(acceptPreparedWeek(f.db, p.token, now).saved, true);
});

test("elevated resting HR produces a lighter week and preserves numeric recovery HR steps", (t) => {
  const f = fixture(t);
  f.db
    .prepare("UPDATE daily_health SET resting_heart_rate=65 WHERE day>=?")
    .run("2026-11-06");
  const p = weeklyPlanning(f.db, now);
  assert.equal(p.recovery.status, "caution");
  assert(p.selected.plan.targetKm < 25);
  assert(p.selected.plan.workouts.every((w) => w.type === "recovery"));
  assert(
    p.options.every((o) =>
      o.calendar.days.every((d) =>
        d.sessions.every(({ session }) => {
          if (session.sport !== "running") return true;
          const steps = session.workout.steps,
            first = steps[0],
            last = steps.at(-1);
          return (
            first.kind === "step" &&
            first.name === "Warm Up" &&
            last?.kind === "step" &&
            last.name === "Cool Down"
          );
        }),
      ),
    ),
  );
  assert(
    p.selected.calendar.days.every((d) =>
      d.sessions.every((s) => s.session.sport === "running"),
    ),
  );
  assert.equal(acceptPreparedWeek(f.db, p.token, now).saved, true);
});

test("reported pain still blocks activation; optional reporting never fabricates absence of symptoms", (t) => {
  const f = fixture(t);
  f.repo.saveCheckIn({
    day: start,
    fatigue: 1,
    soreness: 1,
    pain: 3,
    notes: "PRIVATE NOTE",
  });
  const p = weeklyPlanning(f.db, now);
  assert(p.blockedReason);
  assert.throws(() => acceptPreparedWeek(f.db, p.token, now), /pain/i);
  assert.equal(f.repo.plans().length, 1);
});

test("a real training break still requires the existing return review", (t) => {
  const f = fixture(t);
  new CommitmentRepository(f.db).savePause({
    id: randomUUID(),
    start,
    end: null,
    reason: "travel",
    cancelled: false,
    resumeOn: null,
    returnReviewedAt: null,
    createdAt: now.toISOString(),
  });
  const p = weeklyPlanning(f.db, now);
  assert(p.blockedReason);
  assert.throws(() => acceptPreparedWeek(f.db, p.token, now), /paused|break/i);
});

for (const changed of ["activity", "health", "FTP", "attendance"] as const)
  test(`new ${changed} invalidates approval without partially saving preferences or a plan`, (t) => {
    const f = fixture(t),
      p = weeklyPlanning(f.db, now);
    if (changed === "activity") f.activity("2026-11-08", 1);
    else if (changed === "health")
      f.db
        .prepare(
          "UPDATE daily_health SET resting_heart_rate=60 WHERE day='2026-11-08'",
        )
        .run();
    else if (changed === "FTP")
      f.schedule.savePreferences({
        ...f.schedule.preferences(),
        ftpWatts: 200,
      });
    else
      f.schedule.saveWeek(start, {
        ...f.schedule.week(start),
        hyrox: { monday: "skipping", wednesday: "going", friday: "skipping" },
      });
    const before = f.db.serialize();
    assert.throws(
      () => acceptPreparedWeek(f.db, p.token, now),
      /changed|refresh/i,
    );
    assert.deepEqual(f.db.serialize(), before);
  });

test("an active week and daily moves are never replaced by automatic preparation or re-approval", (t) => {
  const f = fixture(t),
    p = weeklyPlanning(f.db, now);
  acceptPreparedWeek(f.db, p.token, now);
  const active = f.repo.plans().find((p) => p.start === start)!;
  f.schedule.saveChanges([{ day: start, sessions: [] }], null);
  const stored = f.db.serialize();
  assert.equal(weeklyPlanning(f.db, now).needsApproval, false);
  assert.equal(acceptPreparedWeek(f.db, p.token, now).saved, true);
  assert.deepEqual(f.db.serialize(), stored);
  assert.equal(
    fingerprint(f.repo.plans().find((p) => p.start === start)),
    fingerprint(active),
  );
});

test("evidence-backed AI consolidation caches across restarts and still needs human approval", async (t) => {
  const f = fixture(t);
  f.repo.saveCheckIn({
    day: start,
    fatigue: 3,
    soreness: 2,
    pain: 0,
    notes: "",
  });
  let calls = 0;
  assert.equal(
    await worker(
      f.db,
      "consolidate",
      () => calls++,
      "reported_recovery",
    ).tick(),
    "reviewed",
  );
  assert.equal(await worker(f.db, "recommended", () => calls++).tick(), "done");
  assert.equal(calls, 1);
  const p = weeklyPlanning(f.db, now);
  assert.equal(p.source, "ai");
  assert.equal(p.selected.id, "consolidate");
  assert.equal(p.selected.plan.targetKm, 25);
  assert.equal(f.repo.plans().length, 1);
  assert.equal(acceptPreparedWeek(f.db, p.token, now).saved, true);
  assert.equal(await worker(f.db).tick(), "active");
});

test("failed or invalid weekly AI output falls back locally and is not retried", async (t) => {
  for (const kind of ["throw", "invalid"]) {
    const f = fixture(t);
    let calls = 0;
    const w = new WeeklyPlanner(
      f.db,
      async () => {
        calls++;
        if (kind === "throw") throw new Error("PRIVATE PROVIDER RESPONSE");
        return {
          output: { choice: "80km", summary: "Bad", observations: ["Bad"] },
          inputTokens: 1,
          outputTokens: 1,
        };
      },
      true,
      () => now,
    );
    assert.equal(await w.tick(), "failed");
    assert.equal(await w.tick(), "done");
    assert.equal(calls, 1);
    const p = weeklyPlanning(f.db, now);
    assert.equal(p.source, "local");
    assert.equal(p.aiStatus, "unavailable");
    assert.equal(acceptPreparedWeek(f.db, p.token, now).saved, true);
  }
});

test("AI context includes completed workouts and weeks while excluding raw data, GPS, notes and names", (t) => {
  const f = fixture(t);
  f.repo.saveCheckIn({
    day: start,
    fatigue: 1,
    soreness: 1,
    pain: 0,
    notes: "PRIVATE NOTE",
  });
  const context = weeklyModelContext(weeklyPlanning(f.db, now)),
    text = JSON.stringify(context);
  assert(context.history.sessions.length > 0);
  assert.equal(context.history.weeks.length, 4);
  assert(!/PRIVATE|Latitude|Longitude|rawJson/.test(text));
  assert(context.history.sessions.some((s) => s.averageHeartRate === 145));
});

test("concurrent weekly workers and shared request limits prevent duplicate AI spend", async (t) => {
  const f = fixture(t);
  let calls = 0;
  const outcomes = await Promise.all([
    worker(f.db, "recommended", () => calls++).tick(),
    worker(f.db, "recommended", () => calls++).tick(),
  ]);
  assert.equal(calls, 1);
  assert(outcomes.includes("reviewed"));
  assert.equal(
    (
      f.db.prepare("SELECT count(*) n FROM coach_requests").get() as {
        n: number;
      }
    ).n,
    1,
  );
});

test("new evidence after an AI review refreshes the local draft without another paid call", async (t) => {
  const f = fixture(t);
  let calls = 0;
  await worker(f.db, "recommended", () => calls++).tick();
  f.db
    .prepare(
      "UPDATE daily_health SET resting_heart_rate=66 WHERE day>='2026-11-06'",
    )
    .run();
  const p = weeklyPlanning(f.db, now);
  assert.equal(p.source, "local");
  assert.equal(p.aiStatus, "refreshed");
  assert(p.selected.plan.targetKm < 25);
  assert.equal(await worker(f.db, "recommended", () => calls++).tick(), "done");
  assert.equal(calls, 1);
});

test("an old stage is remembered after a gap but its old peak is not automatically restored", (t) => {
  const f = fixture(t);
  f.db.prepare("DELETE FROM training_plans").run();
  f.repo.savePlan(createTrainingPlan(20, "2026-10-05"), now);
  f.db.prepare("DELETE FROM activities WHERE started_at>='2026-10-26'").run();
  const p = weeklyPlanning(f.db, now);
  assert.equal(p.selected.plan.weekNumber, 25);
  assert.equal(p.selected.plan.targetKm, 20);
});

test("Garmin recovery can support daily coaching without a new daily check-in", (t) => {
  const f = fixture(t),
    p = weeklyPlanning(f.db, now);
  acceptPreparedWeek(f.db, p.token, now);
  const context = coachContext(f.db, now);
  assert.equal(context.canSchedule, true);
  assert.equal(context.canAdjust, true);
  assert.equal(context.payload.subjectiveRecovery.lastReportedDay, null);
  assert(!context.constraints.some((s) => s.includes("Log today's check-in")));
});

for (const period of ["day", "month"] as const)
  test(`weekly AI respects the shared ${period} request limit without consuming a weekly attempt`, async (t) => {
    const f = fixture(t);
    const n = period === "day" ? 6 : 60;
    for (let i = 0; i < n; i++)
      f.db
        .prepare(
          "INSERT INTO coach_requests(id,day,created_at,finished) VALUES(?,?,?,1)",
        )
        .run(
          randomUUID(),
          period === "day" ? start : "2026-11-01",
          now.toISOString(),
        );
    let calls = 0;
    assert.equal(
      await worker(f.db, "recommended", () => calls++).tick(),
      "limited",
    );
    assert.equal(calls, 0);
    assert.equal(
      (
        f.db.prepare("SELECT count(*) n FROM weekly_planning").get() as {
          n: number;
        }
      ).n,
      0,
    );
    assert.equal(
      acceptPreparedWeek(f.db, weeklyPlanning(f.db, now).token, now).saved,
      true,
    );
  });

test("routine Hyrox and cycling do not authorize AI consolidation of a supported running increase", async (t) => {
  const f = fixture(t);
  f.db
    .prepare(
      "UPDATE activities SET duration_seconds=? WHERE sport_type='hyrox'",
    )
    .run(144 * 60);
  f.db
    .prepare(
      "UPDATE activities SET duration_seconds=? WHERE sport_type='cycling'",
    )
    .run(210 * 60);
  const p = weeklyPlanning(f.db, now);
  assert.equal(p.selectionPolicy.supportingWorkload.increased, false);
  assert(Math.abs(p.selectionPolicy.supportingWorkload.change ?? 1) < 0.001);
  assert.equal(p.selectionPolicy.reductionEvidence.length, 0);
  assert.equal(p.selected.plan.targetKm, 27);
  // A plausible narrative and an invented concern cannot override the evidence.
  assert.equal(
    await worker(f.db, "consolidate", () => {}, "supporting_increase").tick(),
    "failed",
  );
  const after = weeklyPlanning(f.db, now);
  assert.equal(after.selected.plan.targetKm, 27);
  assert.equal(after.source, "local");
  assert.equal(acceptPreparedWeek(f.db, after.token, now).saved, true);
});

test("supporting-workload growth is context for scaling support, not an automatic running hold", async (t) => {
  const f = fixture(t);
  f.db
    .prepare(
      "UPDATE activities SET duration_seconds=duration_seconds*2 WHERE started_at>='2026-11-02' AND sport_type IN ('cycling','hyrox')",
    )
    .run();
  const p = weeklyPlanning(f.db, now);
  assert.equal(p.selectionPolicy.supportingWorkload.increased, true);
  assert.equal(p.selectionPolicy.supportingWorkload.change, 1);
  assert(
    !p.selectionPolicy.reductionEvidence.some(
      (e) => e.code === "supporting_increase",
    ),
  );
  assert.equal(p.selected.plan.targetKm, 27);
  assert.equal(
    await worker(f.db, "consolidate", () => {}, "supporting_increase").tick(),
    "failed",
  );
  assert.equal(weeklyPlanning(f.db, now).source, "local");
});

for (const reason of [null, "supporting_increase", "local_recommendation"])
  test(`cached unsupported AI hold (${reason}) is corrected locally without deleting history or spending again`, async (t) => {
    const f = fixture(t),
      p = weeklyPlanning(f.db, now);
    const review = {
      choice: "consolidate",
      summary: "Hold at 25 km because Hyrox and cycling exist.",
      observations: ["Routine sessions."],
      ...(reason ? { reason } : {}),
      usage: { inputTokens: 1, outputTokens: 1 },
    };
    f.db
      .prepare(
        "INSERT INTO weekly_planning(week_start,evidence_hash,review_json,attempted_at) VALUES(?,?,?,?)",
      )
      .run(start, p.evidenceHash, JSON.stringify(review), now.toISOString());
    const before = f.db.serialize();
    const corrected = weeklyPlanning(f.db, now);
    assert.equal(corrected.aiStatus, "corrected");
    assert.equal(corrected.selected.plan.targetKm, 27);
    assert(!corrected.summary.includes("Hold at 25"));
    assert.deepEqual(f.db.serialize(), before);
    let calls = 0;
    assert.equal(
      await worker(f.db, "recommended", () => calls++).tick(),
      "done",
    );
    assert.equal(calls, 0);
    assert.equal(acceptPreparedWeek(f.db, corrected.token, now).saved, true);
    assert.equal(f.repo.plans().find((w) => w.start === start)?.targetKm, 27);
  });

test("a verified recovery reduction remains available even when supporting volume is routine", async (t) => {
  const f = fixture(t);
  f.db
    .prepare(
      "UPDATE daily_health SET resting_heart_rate=66 WHERE day>='2026-11-06'",
    )
    .run();
  assert.equal(
    await worker(f.db, "recovery", () => {}, "recovery_caution").tick(),
    "reviewed",
  );
  const p = weeklyPlanning(f.db, now);
  assert.equal(p.source, "ai");
  assert.equal(p.selected.id, "recovery");
  assert(p.selected.plan.targetKm < 25);
  assert.equal(acceptPreparedWeek(f.db, p.token, now).saved, true);
});

test("invalid cached JSON cannot break the weekly planner", (t) => {
  const f = fixture(t),
    p = weeklyPlanning(f.db, now);
  for (const raw of ["null", "[]", "{broken"]) {
    f.db
      .prepare(
        "INSERT OR REPLACE INTO weekly_planning(week_start,evidence_hash,review_json,attempted_at) VALUES(?,?,?,?)",
      )
      .run(start, p.evidenceHash, raw, now.toISOString());
    assert.equal(weeklyPlanning(f.db, now).selected.plan.targetKm, 27);
    assert.equal(weeklyPlanning(f.db, now).aiStatus, "corrected");
  }
});

test("an already accepted 25 km week is not replaced when its old AI selection is corrected", (t) => {
  const f = fixture(t),
    p = weeklyPlanning(f.db, now);
  const active = createTrainingPlan(2, start, 375, 270, 25);
  f.repo.savePlan(active, now);
  f.db
    .prepare(
      "INSERT INTO weekly_planning(week_start,evidence_hash,review_json,attempted_at) VALUES(?,?,?,?)",
    )
    .run(
      start,
      p.evidenceHash,
      JSON.stringify({
        choice: "consolidate",
        summary: "Legacy",
        observations: ["Legacy"],
      }),
      now.toISOString(),
    );
  const before = f.db.serialize(),
    result = weeklyPlanning(f.db, now);
  assert.equal(result.needsApproval, false);
  assert.equal(result.selected.plan.targetKm, 25);
  assert.deepEqual(f.db.serialize(), before);
});

test("Sunday audit prepares Stage 3 at 29 km for Monday and corrects a stale saved Stage 2 only on approval", (t) => {
  const f = fixture(t),
    sunday = new Date("2026-11-15T20:00:00Z"),
    next = "2026-11-16";
  f.repo.savePlan(createTrainingPlan(2, start, 375, 270, 26.3), now);
  f.repo.savePlan(createTrainingPlan(2, next, 375, 270, 26.3), now);
  for (const [day, km] of [
    [0, 5],
    [1, 6],
    [3, 7],
    [5, 9.36],
  ])
    f.activity(shiftDay(start, day), km);
  f.db
    .prepare("UPDATE sync_state SET last_completed_at=?")
    .run(sunday.toISOString());
  const history = f.repo.plans().filter((p) => p.start < next);
  const before = f.db.serialize(),
    p = weeklyPlanning(f.db, sunday, next);
  assert.equal(weeklyPlanning(f.db, sunday).selected.plan.weekNumber, 2);
  assert.deepEqual(p.correction, { savedStage: 2, expectedStage: 3 });
  assert.equal(p.selected.plan.targetKm, 29);
  assert(p.needsApproval);
  assert.deepEqual(f.db.serialize(), before);
  const result = acceptPreparedWeek(f.db, p.token, sunday, next);
  assert.equal(result.plan.weekNumber, 3);
  assert.equal(result.plan.targetKm, 29);
  assert.deepEqual(
    f.repo.plans().filter((p) => p.start < next),
    history,
  );
  assert.equal(acceptPreparedWeek(f.db, p.token, sunday, next).saved, true);
  assert.throws(
    () => weeklyPlanning(f.db, sunday, "2026-11-23"),
    /immediately/,
  );
});

test("a training race does not freeze the next milestone, and its warm-up is outside the mileage budget", (t) => {
  const f = fixture(t);
  new CommitmentRepository(f.db).saveRace({
    id: randomUUID(),
    name: "Training 10k",
    day: "2026-11-15",
    startTime: null,
    distanceKm: 10,
    terrain: "road",
    elevationGain: null,
    expectedMinutes: 55,
    priority: "training",
    status: "planned",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  const p = weeklyPlanning(f.db, now);
  assert.equal(p.selected.plan.weekNumber, 2);
  assert.equal(p.selected.plan.targetKm, 27);
  assert(
    !p.selectionPolicy.reductionEvidence.some(
      (e) => e.code === "calendar_restriction",
    ),
  );
});

test("optional Hyrox is reduced before a supported mileage increase and attendance changes wait for approval", (t) => {
  const f = fixture(t);
  f.schedule.saveWeek(start, {
    ...structuredClone(DEFAULT_WEEK_PREFERENCES),
    hyrox: { monday: "going", wednesday: "going", friday: "going" },
  });
  const before = f.db.serialize(),
    p = weeklyPlanning(f.db, now);
  assert.equal(p.selected.plan.targetKm, 27);
  assert.equal(p.selected.preferences.hyrox.friday, "skipping");
  assert.deepEqual(f.db.serialize(), before);
  assert.equal(f.schedule.week(start).hyrox.friday, "going");
  acceptPreparedWeek(f.db, p.token, now);
  assert.equal(f.schedule.week(start).hyrox.friday, "skipping");
});

test("a post-race cutback keeps its milestone on legal days and the accepted arrangement survives the next day", (t) => {
  const f = fixture(t),
    date = new Date("2026-11-23T10:00:00Z");
  f.repo.savePlan(createTrainingPlan(2, "2026-11-09", 375, 270, 27), now);
  f.repo.savePlan(createTrainingPlan(3, "2026-11-16", 375, 270, 29), now);
  new CommitmentRepository(f.db).saveRace({
    id: randomUUID(),
    name: "Training trail",
    day: "2026-11-22",
    startTime: null,
    distanceKm: 18,
    terrain: "trail",
    elevationGain: 900,
    expectedMinutes: 150,
    priority: "training",
    status: "planned",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  new CommitmentRepository(f.db).saveRace({
    id: randomUUID(),
    name: "Following goal 10k",
    day: "2026-12-05",
    startTime: null,
    distanceKm: 10,
    terrain: "road",
    elevationGain: null,
    expectedMinutes: 50,
    priority: "goal",
    status: "planned",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  f.activity("2026-11-16", 5);
  f.activity("2026-11-17", 6);
  f.activity("2026-11-22", 18);
  f.db
    .prepare("UPDATE sync_state SET last_completed_at=?")
    .run(date.toISOString());
  const p = weeklyPlanning(f.db, date);
  assert.equal(p.selected.plan.weekNumber, 4);
  assert.equal(p.selected.plan.targetKm, 23);
  assert(p.selected.rebalanced);
  assert.equal(calendarMileage(p.selected.calendar, 375).countedKm, 23);
  assert.equal(p.selected.calendar.days[0].sessions.length, 0);
  assert.equal(p.selected.calendar.days[1].sessions.length, 0);
  assert.equal(p.selected.calendar.days[6].sessions.length, 0);
  const days = p.selected.calendar.days
    .filter((d) => d.sessions.some((s) => s.session.sport === "running"))
    .map((d) => d.dayOffset);
  assert.equal(days.length, 3);
  assert(!days.some((i) => days.includes(i + 1) && days.includes(i + 2)));
  const saved = acceptPreparedWeek(f.db, p.token, date).plan;
  const later = trainingCalendar(
    f.db,
    saved,
    new GarminRepository(f.db).allActivities(),
    new Date("2026-11-25T10:00:00Z"),
  );
  assert.equal(calendarMileage(later, 375).countedKm, 23);
  assert.deepEqual(
    later.days
      .filter((d) => d.sessions.some((s) => s.session.sport === "running"))
      .map((d) => d.dayOffset),
    days,
  );
  const edited = saveReviewedPlan(
    f.db,
    {
      weekNumber: 4,
      start: "2026-11-23",
      easyPace: 375,
      tempoPace: 270,
      targetKm: 22,
    },
    date,
  ).plan;
  assert.equal(
    calendarMileage(
      trainingCalendar(
        f.db,
        edited,
        new GarminRepository(f.db).allActivities(),
        new Date("2026-11-25T10:00:00Z"),
      ),
      375,
    ).countedKm,
    22,
  );
});

test("accepted goal-race preparation is not tapered repeatedly when replaying the calendar", (t) => {
  const f = fixture(t);
  new CommitmentRepository(f.db).saveRace({
    id: randomUUID(),
    name: "Goal 10k",
    day: "2026-11-15",
    startTime: null,
    distanceKm: 10,
    terrain: "road",
    elevationGain: null,
    expectedMinutes: 50,
    priority: "goal",
    status: "planned",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  const p = weeklyPlanning(f.db, now),
    expected = calendarMileage(p.selected.calendar, 375);
  const saved = acceptPreparedWeek(f.db, p.token, now).plan;
  const calendar = trainingCalendar(
    f.db,
    saved,
    new GarminRepository(f.db).allActivities(),
    new Date("2026-11-10T10:00:00Z"),
  );
  assert.deepEqual(calendarMileage(calendar, 375), expected);
});

test("a stale legacy race week keeps its old per-run distance until the corrected milestone is accepted", (t) => {
  const f = fixture(t),
    sunday = new Date("2026-11-15T20:00:00Z"),
    next = "2026-11-16";
  f.repo.savePlan(createTrainingPlan(2, start, 375, 270, 26.3), now);
  const old = createTrainingPlan(2, next, 375, 270, 26.3);
  f.repo.savePlan(old, now);
  for (const [day, km] of [
    [0, 5],
    [1, 6],
    [3, 7],
    [5, 9.36],
  ])
    f.activity(shiftDay(start, day), km);
  f.db
    .prepare("UPDATE sync_state SET last_completed_at=?")
    .run(sunday.toISOString());
  new CommitmentRepository(f.db).saveRace({
    id: randomUUID(),
    name: "Training trail",
    day: "2026-11-22",
    startTime: null,
    distanceKm: 18,
    terrain: "trail",
    elevationGain: 900,
    expectedMinutes: 150,
    priority: "training",
    status: "planned",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  const activities = new GarminRepository(f.db).allActivities();
  const before = trainingCalendar(f.db, old, activities, sunday);
  const monday = before.days[0].sessions.find(
    (s) => s.session.sport === "running",
  )!.session;
  assert.ok(monday.sport === "running");
  assert.equal(workoutKm(monday.workout, 375), 5);
  const proposal = weeklyPlanning(f.db, sunday, next);
  assert.equal(proposal.selected.plan.targetKm, 29);
  assert.equal(calendarMileage(proposal.selected.calendar, 375).countedKm, 29);
  assert.equal(f.repo.plans().find((p) => p.start === next)!.weekNumber, 2);
  const saved = acceptPreparedWeek(f.db, proposal.token, sunday, next).plan;
  assert.equal(saved.planningVersion, 2);
  assert.equal(
    calendarMileage(
      trainingCalendar(
        f.db,
        saved,
        activities,
        new Date("2026-11-17T10:00:00Z"),
      ),
      375,
    ).countedKm,
    29,
  );
});
