import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/server/db/migrate";
import { TrainingRepository } from "../src/server/training/repository";
import { GarminRepository } from "../src/server/db/garmin-repository";
import {
  createTrainingPlan,
  planKm,
  workoutKm,
  isDistanceWorkout,
} from "../src/shared/training-plan";
import {
  TEMPO_LEVELS,
  tempoWork,
  tempoLevelMeters,
} from "../src/shared/tempo-progression";
import { developedPlan } from "../src/shared/plan-development";
import { weekView } from "../src/shared/week-view";
import { buildWeekSchedule } from "../src/shared/weekly-schedule";
import { DEFAULT_ATHLETE, DEFAULT_TARGETS } from "../src/shared/types/athlete";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_WEEK_PREFERENCES,
} from "../src/shared/types/schedule";
import { recordPrescriptionCalendar } from "../src/server/training/prescription-snapshots";
import { tempoEvidence } from "../src/server/training/tempo-evidence";
import { developmentReadiness } from "../src/server/training/development";
import { measuredLoad, combinedLoadReview } from "../src/server/training/load";
import { activityReviewFingerprint } from "../src/server/training/workout-reviews";
import { weeklyPlanning } from "../src/server/training/weekly-planning";
import { saveReviewedPlan } from "../src/server/training/save-plan";
import type { RecoveryEvidence } from "../src/shared/types/weekly-planning";
const now = new Date("2026-11-16T10:00:00.000Z");
const supportive: RecoveryEvidence = {
  status: "supportive",
  latestDay: "2026-11-16",
  recentRestingHr: 50,
  baselineRestingHr: 50,
  recentSleepHours: 8,
  recentDays: 3,
  notes: [],
};
function fixture({ capture = true, moved = false, lastKm = 25 } = {}) {
  const d = new Database(":memory:");
  migrateDatabase(d);
  const plans = ["2026-11-02", "2026-11-09"].map((start, i) =>
    createTrainingPlan(i + 1, start, 375, 270, i === 1 ? lastKm : 25, {
      phase: "consolidate",
      qualityLevel: 0,
      reason: "Fixture",
      targets: DEFAULT_TARGETS,
      reviewedAt: null,
    }),
  );
  for (const p of plans) {
    new TrainingRepository(d).savePlan(p);
    if (moved)
      p.workouts = p.workouts.map((w) =>
        w.type === "quality" ? { ...w, dayOffset: 2 } : w,
      );
    if (capture)
      recordPrescriptionCalendar(
        d,
        buildWeekSchedule(p, DEFAULT_WEEK_PREFERENCES, DEFAULT_PREFERENCES),
        375,
        new Date(p.start + "T06:00:00.000Z"),
        "approved",
      );
    for (const w of p.workouts) {
      const day = new Date(
          Date.parse(p.start + "T12:00:00Z") + w.dayOffset * 86400000,
        )
          .toISOString()
          .slice(0, 10),
        id = `${p.start}-${w.type}`;
      d.prepare("INSERT INTO activities VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
        id,
        String(Math.abs(Date.parse(day))),
        "running",
        null,
        day + "T12:00:00.000Z",
        Math.round(workoutKm(w, 375) * 360),
        workoutKm(w, 375) * 1000,
        145,
        170,
        "{}",
        now.toISOString(),
      );
    }
  }
  const activities = new GarminRepository(d).allActivities();
  const load = combinedLoadReview(measuredLoad(activities, [], now));
  const assess = (
    options: {
      status?: RecoveryEvidence["status"];
      sync?: string | null;
      harder?: boolean;
      activities?: typeof activities;
    } = {},
  ) =>
    developmentReadiness(
      DEFAULT_ATHLETE,
      plans,
      options.activities ?? new GarminRepository(d).allActivities(),
      [],
      [],
      load,
      now,
      options.sync === undefined ? now.toISOString() : options.sync,
      { ...supportive, status: options.status ?? "supportive" },
      {
        ...tempoEvidence(d, now),
        ...(options.harder ? { harderRecently: true } : {}),
      },
    );
  return { d, plans, activities, load, assess };
}
test("matched quality-day recordings support unchanged-pace tempo growth without ratings, daily check-ins or automatic calibration", () => {
  const f = fixture();
  try {
    const r = f.assess();
    assert.equal(r.eligible, true);
    assert.equal(r.qualityEvidence, 2);
    assert.equal(r.unverifiedEvidence, 2);
    assert.equal(r.calibrationFresh, false);
    assert.match(r.reason, /not proof of every rep/);
    for (const table of [
      "daily_check_ins",
      "session_efforts",
      "activity_feedback",
      "athlete_profile",
    ])
      assert.equal(
        f.d.prepare<[], { n: number }>(`SELECT count(*) n FROM ${table}`).get()!
          .n,
        0,
      );
  } finally {
    f.d.close();
  }
});
test("date and activity-average matches alone never establish a quality exposure from legacy history", () => {
  const f = fixture({ capture: false });
  try {
    assert.equal(f.assess().eligible, false);
    assert.equal(f.assess().qualityEvidence, 0);
  } finally {
    f.d.close();
  }
});
test("recovery uncertainty/caution, stale sync, recent harder effort and partial running hold extra tempo without requiring a daily report", () => {
  const f = fixture();
  try {
    assert(!f.assess({ status: "unknown" }).eligible);
    assert(!f.assess({ status: "caution" }).eligible);
    assert(!f.assess({ sync: null }).eligible);
    assert(!f.assess({ harder: true }).eligible);
    assert(
      !f.assess({
        activities: f.activities.filter((a) => !a.id.startsWith("2026-11-09")),
      }).eligible,
    );
    assert(f.assess().eligible);
  } finally {
    f.d.close();
  }
});
test("grouped split evidence is only aggregate support when tempo distance, repetition count and pace isolate the blocks", () => {
  const f = fixture();
  try {
    const a = f.activities.find((a) => a.id === "2026-11-09-quality")!;
    function detail(distance: number, pace: number, count = 2) {
      f.d
        .prepare(
          "INSERT OR REPLACE INTO activity_details VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          a.id,
          activityReviewFingerprint(a),
          JSON.stringify({
            splitSummaries: [
              {
                splitType: "INTERVAL_ACTIVE",
                noOfSplits: count,
                distance,
                averageSpeed: 1000 / pace,
              },
            ],
          }),
          "[]",
          now.toISOString(),
          "ready",
          "2027-01-01T00:00:00Z",
        );
    }
    detail(2000, 270);
    assert.equal(f.assess().aggregateEvidence, 1);
    assert(f.assess().eligible);
    detail(6500, 270);
    assert.equal(f.assess().aggregateEvidence, 0);
    assert.equal(f.assess().unverifiedEvidence, 2);
    detail(2000, 270, 3);
    assert.equal(f.assess().aggregateEvidence, 0);
    detail(2000, 300);
    assert(!f.assess().eligible);
    assert(tempoEvidence(f.d, now).adverseRecently);
    f.d
      .prepare(
        "UPDATE activities SET distance_meters=distance_meters+10 WHERE id=?",
      )
      .run(a.id);
    assert.equal(f.assess().aggregateEvidence, 0);
  } finally {
    f.d.close();
  }
});
test("approved moved quality dates count; changed tempo doses and reused observations do not unlock another level", () => {
  const f = fixture({ moved: true });
  try {
    assert.equal(f.assess().qualityEvidence, 2);
    const p = f.plans[1];
    p.development!.qualityLevel = 1;
    assert.equal(f.assess().qualityEvidence, 0);
  } finally {
    f.d.close();
  }
});
test("one small quality step may accompany modest mileage growth; pace/targets, gaps, return and large volume jumps hold it", () => {
  const f = fixture();
  try {
    const previous = f.plans[1],
      readiness = f.assess();
    const settings = {
      weekNumber: 3,
      start: "2026-11-16",
      easyPace: 375,
      tempoPace: 270,
      targetKm: 27,
    };
    const next = developedPlan(settings, DEFAULT_ATHLETE, f.plans, readiness);
    assert.equal(next.development?.qualityLevel, 1);
    assert.equal(next.tempoPace, 270);
    assert.equal(planKm(next), 27);
    assert.equal(
      next.workouts.find((w) => w.type === "quality")?.steps[0].kind,
      "step",
    );
    assert.equal(
      developedPlan(
        { ...settings, targetKm: 29 },
        DEFAULT_ATHLETE,
        f.plans,
        readiness,
      ).development?.qualityLevel,
      0,
    );
    assert.equal(
      developedPlan(
        { ...settings, tempoPace: 265 },
        DEFAULT_ATHLETE,
        f.plans,
        readiness,
      ).development?.qualityLevel,
      0,
    );
    assert.equal(
      developedPlan(
        { ...settings, start: "2026-11-23" },
        DEFAULT_ATHLETE,
        f.plans,
        readiness,
      ).development?.qualityLevel,
      0,
    );
    assert.equal(
      developedPlan(
        settings,
        { ...DEFAULT_ATHLETE, targets: { ...DEFAULT_TARGETS, baseMax: 150 } },
        f.plans,
        readiness,
      ).development?.qualityLevel,
      0,
    );
    assert.deepEqual(
      developedPlan(settings, DEFAULT_ATHLETE, [...f.plans, next], readiness),
      next,
    );
    assert.equal(previous.development?.qualityLevel, 0);
  } finally {
    f.d.close();
  }
});
test("all 30 stages preserve weekly totals, numeric distance steps, bookends and 6×80m strides while bounding new tempo work", () => {
  for (let stage = 1; stage <= 30; stage++)
    for (let level = 0; level < TEMPO_LEVELS.length; level++) {
      const p = createTrainingPlan(stage, "2026-11-16", 375, 270, undefined, {
        phase: stage % 4 === 0 ? "cutback" : "volume",
        qualityLevel: level,
        reason: "Fixture",
        targets: DEFAULT_TARGETS,
        reviewedAt: null,
      });
      assert(Math.abs(planKm(p) - p.targetKm) < 0.001);
      for (const w of p.workouts) {
        assert(isDistanceWorkout(w));
        assert(workoutKm(w, p.easyPace) >= 5);
        assert.equal(w.steps[0].kind === "step" && w.steps[0].name, "Warm Up");
        const last = w.steps.at(-1)!;
        assert(last.kind === "step");
        assert.equal(last.name, "Cool Down");
        const work = tempoWork(w);
        if (work) assert(work.meters <= Math.max(2000, p.targetKm * 100));
        if (w.type === "strides") {
          const s = w.steps.find((s) => s.kind === "repeat")!;
          assert(s.kind === "repeat");
          assert.equal(s.times, 6);
          assert.deepEqual(s.steps[0], {
            kind: "step",
            name: "Run",
            amount: { kind: "distance", meters: 80 },
            target: { kind: "pace", min: 240, max: 270 },
          });
        }
      }
    }
});
test("January 11 forecasts progressive tempo within 42km, labelled conditional; saved custom weeks remain exact", () => {
  const anchor = createTrainingPlan(3, "2026-11-16", 375, 270, 29, {
    phase: "volume",
    qualityLevel: 0,
    reason: "Fixture",
    targets: DEFAULT_TARGETS,
    reviewedAt: null,
  });
  const context = {
    monday: anchor.start,
    plans: [anchor],
    prepared: anchor,
    athlete: DEFAULT_ATHLETE,
  };
  const before = JSON.stringify(context);
  const view = weekView("2027-01-11", context);
  assert.equal(view.kind, "projection");
  assert.equal(view.plan.targetKm, 42);
  assert.equal(view.plan.development?.qualityForecast, true);
  const q = view.plan.workouts.find((w) => w.type === "quality")!;
  assert.equal(tempoWork(q)?.meters, 3000);
  assert.equal(q.title, "Tempo · 3 × 1.00 km");
  assert.equal(tempoWork(q)?.min, 265);
  assert.equal(JSON.stringify(context), before);
  const saved = {
    ...view.plan,
    development: { ...view.plan.development!, qualityForecast: false },
    workouts: view.plan.workouts.map((w, i) => ({
      ...w,
      title: i === 0 ? "My reviewed run" : w.title,
    })),
  };
  assert.deepEqual(
    weekView(saved.start, { ...context, plans: [anchor, saved] }).plan,
    saved,
  );
});
test("a future forecast cannot be activated directly even when its mileage matches an available weekly proposal", () => {
  const d = new Database(":memory:");
  migrateDatabase(d);
  try {
    const p = createTrainingPlan(1, "2026-11-16", 375, 270, 25, {
      phase: "volume",
      qualityLevel: 0,
      qualityForecast: true,
      reason: "Conditional",
      targets: DEFAULT_TARGETS,
      reviewedAt: null,
    });
    assert.throws(
      () =>
        saveReviewedPlan(
          d,
          {
            weekNumber: 1,
            start: p.start,
            easyPace: 375,
            tempoPace: 270,
            targetKm: 25,
          },
          now,
          p,
        ),
      /forecasts cannot be activated/,
    );
    assert.equal(new TrainingRepository(d).plans().length, 0);
  } finally {
    d.close();
  }
});
test("new pace validation remains independent of tempo-distance eligibility and forecast steps cannot supply recorded evidence", () => {
  const f = fixture();
  try {
    f.d
      .prepare(
        "INSERT INTO sync_state(provider,last_completed_at,updated_at) VALUES('garmin',?,?)",
      )
      .run(now.toISOString(), now.toISOString());
    const planning = weeklyPlanning(f.d, now);
    assert.equal(planning.selected.plan.tempoPace, 270);
    assert.equal(new TrainingRepository(f.d).plans().length, 2);
    const r = f.assess();
    assert(!r.calibrationFresh);
    assert(r.eligible);
    const q = planning.selected.plan.workouts.find((w) => w.type === "quality");
    assert(q);
    assert(tempoWork(q)!.meters <= tempoLevelMeters(1));
  } finally {
    f.d.close();
  }
});

test("weekly preparation offers a tempo step during 27→29km growth from unrated matched runs and Garmin recovery, without activating it", () => {
  const f = fixture({ lastKm: 27 });
  try {
    for (let i = 0; i < 20; i++) {
      const day = new Date(now.getTime() - i * 86400000)
        .toISOString()
        .slice(0, 10);
      f.d
        .prepare(
          "INSERT INTO daily_health(id,day,sleep_seconds,resting_heart_rate,body_battery,raw_json,imported_at) VALUES(?,?,28800,50,80,'{}',?)",
        )
        .run(day, day, now.toISOString());
    }
    f.d
      .prepare(
        "INSERT INTO sync_state(provider,last_completed_at,updated_at) VALUES('garmin',?,?)",
      )
      .run(now.toISOString(), now.toISOString());
    const result = weeklyPlanning(f.d, now);
    assert.equal(result.selected.plan.targetKm, 29);
    assert.equal(result.selected.plan.development?.qualityLevel, 1);
    assert.equal(result.selected.plan.tempoPace, 270);
    assert.equal(
      tempoWork(
        result.selected.plan.workouts.find((w) => w.type === "quality")!,
      )?.meters,
      2600,
    );
    assert.equal(result.needsApproval, true);
    assert.equal(new TrainingRepository(f.d).plans().length, 2);
  } finally {
    f.d.close();
  }
});
