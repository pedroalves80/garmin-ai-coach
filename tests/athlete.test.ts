import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/server/db/migrate";
import {
  AthleteRepository,
  athleteSchema,
} from "../src/server/training/athlete-repository";
import { TrainingRepository } from "../src/server/training/repository";
import { ScheduleRepository } from "../src/server/training/schedule-repository";
import { measuredLoad, combinedLoadReview } from "../src/server/training/load";
import { developmentReadiness } from "../src/server/training/development";
import { assessProgression } from "../src/server/training/progression";
import { weeklyMetrics } from "../src/server/training/metrics";
import { coachContext } from "../src/server/coach/context";
import { CoachService } from "../src/server/coach/service";
import {
  trainingCalendar,
  skipSecondarySession,
  moveRunningDay,
  trainingEvidencePlans,
} from "../src/server/training/calendar";
import {
  createTrainingPlan,
  planKm,
  workoutKm,
  isDistanceWorkout,
} from "../src/shared/training-plan";
import { developedPlan } from "../src/shared/plan-development";
import { reviewPlannedWeek } from "../src/shared/planned-load";
import { buildWeekSchedule } from "../src/shared/weekly-schedule";
import { DEFAULT_ATHLETE, DEFAULT_TARGETS } from "../src/shared/types/athlete";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_WEEK_PREFERENCES,
} from "../src/shared/types/schedule";
import type {
  ActivityMeasurement,
  DailyCheckIn,
} from "../src/shared/types/metrics";
const now = new Date("2026-11-02T12:00:00Z");
function activity(
  id: string,
  day: string,
  km = 5,
  rpeSport = "running",
  minutes = km * 6,
): ActivityMeasurement {
  return {
    id,
    name: null,
    sportType: rpeSport,
    startedAt: `${day}T10:00:00Z`,
    durationSeconds: minutes * 60,
    distanceMeters: km * 1000,
    averageHeartRate: 140,
    rawJson: "{}",
  };
}
function check(day: string): DailyCheckIn {
  return { day, fatigue: 1, soreness: 1, pain: 0, notes: "" };
}
function returnFixture() {
  const plans = [
    createTrainingPlan(3, "2026-10-19"),
    createTrainingPlan(4, "2026-10-26"),
  ];
  const activities = [
    activity("a", "2026-10-19", 5),
    activity("b", "2026-10-20", 5),
    activity("c", "2026-10-22", 9),
    activity("d", "2026-10-24", 10),
    activity("e", "2026-10-26", 5),
    activity("f", "2026-10-27", 5),
    activity("g", "2026-10-29", 6),
    activity("h", "2026-10-31", 7),
  ];
  const efforts = activities.map((a) => ({ activityId: a.id, rpe: 3 }));
  const weeks = weeklyMetrics(activities, now);
  const load = combinedLoadReview(measuredLoad(activities, efforts, now));
  return {
    now,
    plans,
    activities,
    efforts,
    weeks,
    load,
    lastSync: now.toISOString(),
    checkIns: [
      check("2026-10-24"),
      check("2026-10-25"),
      check("2026-10-30"),
      check("2026-10-31"),
      check("2026-11-02"),
    ],
  };
}

test("a completed planned cutback can return to verified volume without treating it as a new peak", () => {
  const f = returnFixture();
  assert(f.load.cleared);
  const result = assessProgression(f);
  assert.equal(result.decision, "increase");
  assert.equal(result.suggestedKm, 29);
  assert(result.reasons[0].includes("cutback"));
  const incomplete = assessProgression({
    ...f,
    weeks: f.weeks.map((w) =>
      w.start === "2026-10-26" ? { ...w, runningKm: 10 } : w,
    ),
  });
  assert.equal(incomplete.decision, "hold");
  const noEvidence = assessProgression({
    ...f,
    checkIns: f.checkIns.filter((c) => c.day >= "2026-10-26"),
  });
  assert.equal(noEvidence.suggestedKm, 24.2);
  assert.equal(
    assessProgression({
      ...f,
      checkIns: f.checkIns.map((c) => ({
        ...c,
        pain: c.day === "2026-11-02" ? 1 : 0,
      })),
    }).decision,
    "reduce",
  );
});

test("a missed or old peak does not authorize a large return, and future plans never establish volume", () => {
  const f = returnFixture();
  const missed = assessProgression({
    ...f,
    weeks: f.weeks.map((w) =>
      w.start === "2026-10-19" ? { ...w, runningKm: 10 } : w,
    ),
  });
  assert.equal(missed.suggestedKm, 24.2);
  const future = assessProgression({
    ...f,
    plans: [...f.plans, createTrainingPlan(30, "2026-12-07")],
  });
  assert.equal(future.suggestedKm, 29);
  const old = assessProgression({
    ...f,
    plans: [{ ...f.plans[0], start: "2026-09-21" }, f.plans[1]],
  });
  assert.equal(old.suggestedKm, 24.2);
});

test("session-RPE measures intensity across sports, excludes wellness and labels unknown effort", () => {
  const acts = [
    activity("easy", "2026-10-19", 0, "cycling", 60),
    activity("hard", "2026-10-20", 0, "hyrox", 60),
    activity("yoga", "2026-10-21", 0, "yoga", 60),
    activity("unknown", "2026-10-22", 5),
    activity("future", "2026-11-03", 5),
  ];
  const weeks = measuredLoad(
    acts,
    [
      { activityId: "easy", rpe: 2 },
      { activityId: "hard", rpe: 8 },
    ],
    now,
  );
  const week = weeks.find((w) => w.start === "2026-10-19")!;
  assert.equal(week.measuredAu, 600);
  assert.equal(week.sessions, 3);
  assert.equal(week.unknownSessions, 1);
  assert.equal(week.hardDays, 1);
  assert(!combinedLoadReview(weeks).cleared);
  assert.equal(weeks.at(-1)!.sessions, 0);
});

test("optional effort ratings do not block stable progression, while measured combined growth still does", () => {
  const f = returnFixture();
  const missing = combinedLoadReview(measuredLoad(f.activities, [], now));
  assert(!missing.cleared);
  assert.equal(missing.latest.coverage, 0);
  assert.equal(assessProgression({ ...f, load: missing }).decision, "increase");
  const raised = f.efforts.map((e) => ({
    ...e,
    rpe: ["e", "f", "g", "h"].includes(e.activityId) ? 8 : 2,
  }));
  const load = combinedLoadReview(measuredLoad(f.activities, raised, now));
  assert(!load.cleared);
  assert(load.reasons.some((r) => r.includes("15%")));
  assert.equal(assessProgression({ ...f, load }).decision, "hold");
});

test("quality progresses at stable volume with evidence, and never repeatedly through future previews", () => {
  const previous = developedPlan(
    {
      weekNumber: 5,
      start: "2026-10-19",
      targetKm: 29,
      easyPace: 375,
      tempoPace: 270,
    },
    DEFAULT_ATHLETE,
    [],
    { eligible: false, level: 0, referenceStart: null },
  );
  const readiness = {
    eligible: true,
    level: 0,
    referenceStart: previous.start,
  };
  const held = developedPlan(
    {
      weekNumber: 6,
      start: "2026-10-26",
      targetKm: 29,
      easyPace: 375,
      tempoPace: 270,
    },
    DEFAULT_ATHLETE,
    [previous],
    readiness,
  );
  assert.equal(held.development?.phase, "quality");
  assert.equal(held.development?.qualityLevel, 1);
  assert.equal(planKm(held), 29);
  assert(
    held.workouts.find((w) => w.type === "quality")!.title.includes("1.30"),
  );
  const volume = developedPlan(
    {
      weekNumber: 6,
      start: "2026-10-26",
      targetKm: 29.5,
      easyPace: 375,
      tempoPace: 270,
    },
    DEFAULT_ATHLETE,
    [previous],
    readiness,
  );
  assert.equal(volume.development?.qualityLevel, 0);
  const future = developedPlan(
    {
      weekNumber: 7,
      start: "2026-11-09",
      targetKm: 29,
      easyPace: 375,
      tempoPace: 270,
    },
    DEFAULT_ATHLETE,
    [previous, held],
    readiness,
  );
  assert.equal(future.development?.qualityLevel, 1);
  const same = developedPlan(
    {
      weekNumber: 6,
      start: held.start,
      targetKm: 29,
      easyPace: 375,
      tempoPace: 270,
    },
    DEFAULT_ATHLETE,
    [previous, held],
    readiness,
  );
  assert.deepEqual(same, held);
});

test("development requires recent reviewed targets, rated quality, recovery and combined-load evidence", () => {
  const f = returnFixture();
  const p1 = developedPlan(
    {
      weekNumber: 5,
      start: "2026-10-19",
      targetKm: 29,
      easyPace: 375,
      tempoPace: 270,
    },
    DEFAULT_ATHLETE,
    [],
    { eligible: false, level: 0, referenceStart: null },
  );
  const p2 = { ...p1, start: "2026-10-26", weekNumber: 6 };
  const acts = [
    activity("m1", "2026-10-19", 5),
    activity("t1", "2026-10-20", 5),
    activity("quality1", "2026-10-22", 9),
    activity("sat1", "2026-10-24", 10),
    activity("m2", "2026-10-26", 5),
    activity("t2", "2026-10-27", 5),
    activity("quality2", "2026-10-29", 9),
    activity("sat2", "2026-10-31", 10),
  ];
  const efforts = acts.map((a) => ({
    activityId: a.id,
    rpe: a.id.startsWith("quality") ? 6 : 2,
    prescriptionCompleted: a.id.startsWith("quality"),
  }));
  const profile = {
    ...DEFAULT_ATHLETE,
    calibrationSource: "field_test" as const,
    reviewedAt: "2026-10-20",
    evidence: "PRIVATE REVIEW",
  };
  const load = { ...f.load, cleared: true };
  const eligible = developmentReadiness(
    profile,
    [p1, p2],
    acts,
    efforts,
    f.checkIns,
    load,
    now,
    f.lastSync,
  );
  assert(eligible.eligible);
  assert.equal(
    developmentReadiness(
      DEFAULT_ATHLETE,
      [p1, p2],
      acts,
      efforts,
      f.checkIns,
      load,
      now,
      f.lastSync,
    ).eligible,
    false,
  );
  assert.equal(
    developmentReadiness(
      { ...profile, reviewedAt: "2026-08-01" },
      [p1, p2],
      acts,
      efforts,
      f.checkIns,
      load,
      now,
      f.lastSync,
    ).eligible,
    false,
  );
  assert.equal(
    developmentReadiness(
      profile,
      [p1, p2],
      acts,
      [],
      f.checkIns,
      load,
      now,
      f.lastSync,
    ).eligible,
    false,
  );
});

test("quality holds when the Garmin sync is stale or there is no recent completed running week", () => {
  const f = returnFixture();
  const profile = {
    ...DEFAULT_ATHLETE,
    calibrationSource: "field_test" as const,
    reviewedAt: "2026-10-20",
    evidence: "Reviewed field results",
  };
  const stale = developmentReadiness(
    profile,
    f.plans,
    f.activities,
    f.efforts,
    f.checkIns,
    f.load,
    now,
    null,
  );
  assert(!stale.eligible);
  assert(stale.reason.includes("Sync"));
});

test("every development level and cutback preserves exact mileage, 5 km runs, distance steps and Sunday rest", () => {
  for (let stage = 1; stage <= 30; stage++)
    for (let level = 0; level <= 6; level++) {
      const plan = createTrainingPlan(
        stage,
        "2026-11-02",
        375,
        270,
        undefined,
        {
          phase: stage % 4 === 0 ? "cutback" : "consolidate",
          qualityLevel: level,
          reason: "Audit fixture",
          targets: DEFAULT_TARGETS,
          reviewedAt: null,
        },
      );
      assert(Math.abs(planKm(plan) - plan.targetKm) < 0.001);
      for (const run of plan.workouts) {
        assert(run.dayOffset < 6);
        assert(workoutKm(run, 375) >= 5);
        assert(isDistanceWorkout(run));
      }
      if (plan.cutback)
        assert(
          plan.workouts.every((w) => !["quality", "strides"].includes(w.type)),
        );
    }
});

test("weekly coordination flags Hyrox before key runs and skipping support preserves moved runs", () => {
  const db = new Database(":memory:");
  migrateDatabase(db);
  const training = new TrainingRepository(db),
    repo = new ScheduleRepository(db),
    plan = createTrainingPlan(1, "2026-11-02");
  training.savePlan(plan);
  const load = returnFixture().load;
  const review = reviewPlannedWeek(
    buildWeekSchedule(plan, DEFAULT_WEEK_PREFERENCES, DEFAULT_PREFERENCES),
    plan,
    load,
  );
  assert(review.suggestedSkips.includes(2));
  assert(review.suggestedSkips.includes(4));
  assert.equal(review.hardDays, 4);
  repo.saveChanges(moveRunningDay(db, plan, 0, 2, [], now), null);
  repo.saveChanges(skipSecondarySession(db, plan, 2, [], now), null);
  const day = trainingCalendar(db, plan, [], now).days[2];
  assert.equal(day.sessions.length, 1);
  assert.equal(day.sessions[0].session.sport, "running");
  assert.throws(() => skipSecondarySession(db, plan, 6, [], now), /Monday/);
  db.close();
});

test("athlete settings validate evidence and ranges and old saved plan snapshots survive migrations", () => {
  assert(
    !athleteSchema.safeParse({
      ...DEFAULT_ATHLETE,
      targets: { ...DEFAULT_TARGETS, baseMin: 160, baseMax: 140 },
    }).success,
  );
  assert(
    !athleteSchema.safeParse({
      ...DEFAULT_ATHLETE,
      calibrationSource: "field_test",
      reviewedAt: "2026-10-20",
      evidence: "",
    }).success,
  );
  const db = new Database(":memory:");
  migrateDatabase(db);
  new TrainingRepository(db).savePlan(createTrainingPlan(1, "2026-11-02"));
  migrateDatabase(db);
  assert.equal(new TrainingRepository(db).plans().length, 1);
  const profile = {
    ...DEFAULT_ATHLETE,
    calibrationSource: "coach_review" as const,
    reviewedAt: "2026-10-20",
    evidence: "PRIVATE REVIEW",
  };
  new AthleteRepository(db).saveProfile(profile);
  assert.deepEqual(new AthleteRepository(db).profile(), profile);
  db.close();
});

test("a hard previous session protects today's quality even with no later session; evidence notes stay local", async () => {
  const db = new Database(":memory:");
  migrateDatabase(db);
  const training = new TrainingRepository(db),
    repo = new AthleteRepository(db),
    time = new Date("2026-10-29T12:00:00Z");
  training.savePlan(createTrainingPlan(1, "2026-10-26"));
  training.saveCheckIn(check("2026-10-29"));
  new ScheduleRepository(db).saveWeek("2026-10-26", {
    ...DEFAULT_WEEK_PREFERENCES,
    cyclingDays: [],
  });
  db.prepare(
    "INSERT INTO sync_state(provider,last_completed_at,updated_at) VALUES('garmin',?,?)",
  ).run(time.toISOString(), time.toISOString());
  db.prepare(
    "INSERT INTO activities(id,provider_activity_id,sport_type,started_at,duration_seconds,raw_json,imported_at) VALUES('hard','hard','hyrox','2026-10-28T17:00:00Z',3600,'{}',?)",
  ).run(time.toISOString());
  repo.saveEffort({ activityId: "hard", rpe: 8 });
  repo.saveProfile({
    ...DEFAULT_ATHLETE,
    evidence: "PRIVATE REVIEW",
    targets: { ...DEFAULT_TARGETS, recoveryMin: 128, recoveryMax: 138 },
  });
  const context = coachContext(db, time);
  assert.deepEqual(context.allowed, ["easy", "rest"]);
  assert(!JSON.stringify(context.payload).includes("PRIVATE REVIEW"));
  const coach = new CoachService(
    db,
    async () => ({
      output: {
        summary: "Recover after yesterday.",
        observations: ["Hard class recorded."],
        action: "easy",
        reason: "Preserve running recovery.",
      },
      inputTokens: 1,
      outputTokens: 1,
    }),
    "test",
    () => time,
  );
  const { review } = await coach.review("today");
  assert.deepEqual(
    review.proposal?.after?.steps.map((s) =>
      s.kind === "step" ? s.name : "Repeat",
    ),
    ["Warm Up", "Run", "Cool Down"],
  );
  assert.equal(workoutKm(review.proposal!.after!, 375), 6.59);
  assert.deepEqual(review.proposal?.after?.steps[1], {
    kind: "step",
    name: "Run",
    amount: { kind: "distance", meters: 5590 },
    target: { kind: "hr", min: 128, max: 138 },
  });
  db.close();
});

test("unplanned recovery reductions remove quality without authorizing an automatic peak restoration", () => {
  const previous = developedPlan(
    {
      weekNumber: 5,
      start: "2026-10-19",
      targetKm: 29,
      easyPace: 375,
      tempoPace: 270,
    },
    DEFAULT_ATHLETE,
    [],
    { eligible: false, level: 0, referenceStart: null },
  );
  const recovery = developedPlan(
    {
      weekNumber: 6,
      start: "2026-10-26",
      targetKm: 23,
      easyPace: 375,
      tempoPace: 270,
    },
    DEFAULT_ATHLETE,
    [previous],
    { eligible: false, level: 0, referenceStart: null },
  );
  assert.equal(recovery.development?.phase, "recovery");
  const rebuilt = developedPlan(
    {
      weekNumber: 7,
      start: "2026-11-02",
      targetKm: 24.2,
      easyPace: 375,
      tempoPace: 270,
    },
    DEFAULT_ATHLETE,
    [previous, recovery],
    { eligible: false, level: 0, referenceStart: null },
  );
  assert.equal(rebuilt.development?.phase, "volume");
  assert(
    recovery.workouts.every((w) => !["quality", "strides"].includes(w.type)),
  );
  const f = returnFixture();
  const result = assessProgression({ ...f, plans: [previous, recovery] });
  assert.equal(result.suggestedKm, 24.2);
  const db = new Database(":memory:");
  migrateDatabase(db);
  new TrainingRepository(db).savePlan(recovery);
  assert.equal(
    new TrainingRepository(db).plans()[0].development?.phase,
    "recovery",
  );
  db.close();
});

test("quality evidence follows approved moved dates while keeping the reviewed mileage baseline", () => {
  const db = new Database(":memory:");
  migrateDatabase(db);
  const repo = new TrainingRepository(db),
    schedule = new ScheduleRepository(db);
  const plan = createTrainingPlan(1, "2026-10-19");
  repo.savePlan(plan);
  const quality = plan.workouts.find((w) => w.type === "quality")!;
  const moved = { ...quality, dayOffset: 2 };
  schedule.saveChanges(
    [
      {
        day: "2026-10-21",
        sessions: [{ sport: "running", slot: "lunch", workout: moved }],
      },
      { day: "2026-10-22", sessions: [] },
    ],
    null,
  );
  const evidence = trainingEvidencePlans(db, [plan], [], now)[0];
  assert.equal(
    evidence.workouts.find((w) => w.type === "quality")?.dayOffset,
    2,
  );
  assert.equal(evidence.targetKm, plan.targetKm);
  assert.equal(planKm(evidence), planKm(plan));
  db.close();
});

test("a post-break recovery baseline on a cutback-numbered stage cannot unlock an old peak", () => {
  const f = returnFixture(),
    recovery = {
      ...f.plans[1],
      development: {
        phase: "recovery" as const,
        qualityLevel: 0,
        reason: "Return baseline",
        targets: DEFAULT_TARGETS,
        reviewedAt: null,
      },
    };
  const plans = [f.plans[0], recovery];
  assert.equal(assessProgression({ ...f, plans }).suggestedKm, 24.2);
  const next = developedPlan(
    {
      weekNumber: 5,
      start: "2026-11-02",
      targetKm: 24.2,
      easyPace: 375,
      tempoPace: 270,
    },
    DEFAULT_ATHLETE,
    plans,
    { eligible: false, level: 0, referenceStart: null },
  );
  assert.equal(next.development?.phase, "volume");
});
