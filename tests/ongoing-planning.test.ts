import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  trainingCycle,
  volumeMilestones,
  DEFAULT_PLANNING_POLICY,
} from "../src/shared/training-cycle";
import {
  createTrainingPlan,
  planKm,
  workoutKm,
  isDistanceWorkout,
} from "../src/shared/training-plan";
import { milestoneForWeek } from "../src/shared/milestones";
import { weekView } from "../src/shared/week-view";
import { DEFAULT_ATHLETE } from "../src/shared/types/athlete";
import { migrateDatabase } from "../src/server/db/migrate";
import { TrainingRepository } from "../src/server/training/repository";
import { ScheduleRepository } from "../src/server/training/schedule-repository";
import {
  planningPolicy,
  planningPolicyReview,
  savePlanningPolicy,
} from "../src/server/training/planning-policy";
import { weeklyPlanning } from "../src/server/training/weekly-planning";
import {
  weeklyModelContext,
  acceptPreparedWeek,
} from "../src/server/coach/weekly";
import { coachContext } from "../src/server/coach/context";
import { calendarDate, shiftDay } from "../src/server/training/dates";
import {
  savedPlanSchema,
  planSettingsSchema,
} from "../src/server/training/validation";
import { DEFAULT_WEEK_PREFERENCES } from "../src/shared/types/schedule";
import { CommitmentRepository } from "../src/server/training/commitment-repository";
const anchor = "2026-11-02";
const dateFor = (week: number) => shiftDay(anchor, (week - 1) * 7);
function db() {
  const d = new Database(":memory:");
  d.pragma("foreign_keys=ON");
  migrateDatabase(d);
  migrateDatabase(d);
  return d;
}
function addRun(d: Database.Database, day: string, km: number) {
  const id = randomUUID();
  d.prepare(
    "INSERT INTO activities(id,provider_activity_id,sport_type,name,started_at,duration_seconds,distance_meters,average_heart_rate,max_heart_rate,raw_json,imported_at) VALUES(?,?, 'running',NULL,?,?,?,?,?,'{}',?)",
  ).run(
    id,
    id,
    day + "T10:00:00.000Z",
    km * 375,
    km * 1000,
    145,
    168,
    day + "T12:00:00.000Z",
  );
  return id;
}
function health(d: Database.Database, now: Date) {
  const today = calendarDate(now);
  for (let i = 0; i < 28; i++) {
    const day = shiftDay(today, -i);
    d.prepare(
      "INSERT OR REPLACE INTO daily_health(id,day,sleep_seconds,resting_heart_rate,body_battery,raw_json,imported_at) VALUES(?,?,28800,50,80,'{}',?)",
    ).run(day, day, now.toISOString());
  }
  d.prepare(
    "INSERT OR REPLACE INTO sync_state(provider,last_completed_at,updated_at) VALUES('garmin',?,?)",
  ).run(now.toISOString(), now.toISOString());
}
function ready(week = 37) {
  const d = db(),
    repo = new TrainingRepository(d);
  repo.savePlan(createTrainingPlan(1, anchor));
  for (let n = week - 6; n < week; n++) {
    const p = createTrainingPlan(n, dateFor(n));
    repo.savePlan(p);
    for (const w of p.workouts)
      addRun(d, shiftDay(p.start, w.dayOffset), workoutKm(w, p.easyPace));
  }
  const now = new Date(dateFor(week) + "T12:00:00.000Z");
  health(d, now);
  return { d, repo, now };
}

test("initial milestones are unchanged and week numbering continues through years without clamping", () => {
  assert.deepEqual(
    volumeMilestones,
    [
      25, 27, 29, 23, 30, 32, 34, 27, 36, 39, 42, 36, 45, 48, 52, 44, 55, 58,
      62, 52, 64, 68, 72, 60, 70, 74, 78, 66, 76, 80,
    ],
  );
  const first = createTrainingPlan(1, anchor);
  for (const n of [1, 30, 31, 36, 37, 52, 53, 156, 157, 260, 521, 2601]) {
    const start = dateFor(n),
      m = milestoneForWeek(start, [first]);
    assert.equal(m.stage, n);
    assert(Number.isFinite(m.km));
    const p = createTrainingPlan(n, start);
    assert.equal(planKm(p), m.km);
    assert(savedPlanSchema.safeParse(p).success);
    assert(
      planSettingsSchema.safeParse({
        weekNumber: n,
        start,
        easyPace: 375,
        tempoPace: 270,
        targetKm: p.targetKm,
      }).success,
    );
  }
  for (let n = 1; n <= 30; n++)
    assert(!("policy" in createTrainingPlan(n, dateFor(n))));
});
test("six consolidation weeks lead to indefinitely repeating performance and cutback blocks", () => {
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => trainingCycle(31 + i).km),
    [76, 78, 64, 78, 80, 64],
  );
  assert.deepEqual(
    Array.from({ length: 12 }, (_, i) => trainingCycle(37 + i).km),
    [76, 78, 80, 64, 76, 78, 80, 64, 76, 78, 80, 64],
  );
  assert(trainingCycle(33).cutback);
  assert(!trainingCycle(32).cutback);
  assert.equal(trainingCycle(36).phase, "consolidation");
  assert.equal(trainingCycle(1000).phase, "performance");
});
test("all new cycles keep exact weekly distance, >=5km runs, bookends, Sunday rest and existing stride targets", () => {
  for (const week of [
    31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 51, 52, 53, 260, 521,
  ]) {
    const p = createTrainingPlan(week, dateFor(week));
    assert.equal(planKm(p), p.targetKm);
    for (const w of p.workouts) {
      assert(workoutKm(w, p.easyPace) >= 5);
      assert(w.dayOffset < 6);
      assert(isDistanceWorkout(w));
      assert(w.steps[0].kind === "step" && w.steps[0].name === "Warm Up");
      const last = w.steps.at(-1)!;
      assert(last.kind === "step" && last.name === "Cool Down");
      if (p.cutback) assert(!["quality", "strides"].includes(w.type));
      if (w.type === "strides") {
        const repeats = w.steps.find((s) => s.kind === "repeat")!;
        assert(repeats.kind === "repeat");
        assert.equal(repeats.times, 6);
        assert.deepEqual(repeats.steps[0], {
          kind: "step",
          name: "Run",
          amount: { kind: "distance", meters: 80 },
          target: { kind: "pace", min: 240, max: 270 },
        });
      }
    }
  }
});
test("future forecasts retain first-build and post-build identity and never rewrite approved snapshots", () => {
  const p = createTrainingPlan(1, anchor),
    before = JSON.stringify(p);
  const context = {
    monday: anchor,
    plans: [p],
    prepared: p,
    athlete: DEFAULT_ATHLETE,
  };
  for (const n of [31, 33, 37, 52, 53, 104]) {
    const view = weekView(dateFor(n), context);
    assert.equal(view.kind, "projection");
    assert.equal(view.plan.weekNumber, n);
    assert.equal(view.plan.targetKm, trainingCycle(n).km);
    assert(view.plan.development?.qualityForecast);
  }
  const saved = createTrainingPlan(52, dateFor(52), 375, 270, 60);
  saved.workouts[0].title = "Approved custom day";
  assert.deepEqual(
    weekView(saved.start, { ...context, plans: [p, saved] }).plan,
    saved,
  );
  assert.equal(JSON.stringify(p), before);
});
test("history and attendance survive more than three years and the original anchor is retained", () => {
  const d = db();
  try {
    const repo = new TrainingRepository(d),
      schedule = new ScheduleRepository(d);
    d.transaction(() => {
      for (let n = 1; n <= 220; n++) {
        repo.savePlan(createTrainingPlan(n, dateFor(n)));
        schedule.saveWeek(dateFor(n), DEFAULT_WEEK_PREFERENCES);
      }
    })();
    assert.equal(repo.plans().length, 220);
    assert.equal(Object.keys(schedule.weeks()).length, 220);
    assert(repo.plans().some((p) => p.start === anchor));
    assert.equal(milestoneForWeek(dateFor(221), repo.plans()).stage, 221);
    const historical = weekView(dateFor(40), {
      monday: dateFor(221),
      plans: repo.plans(),
      prepared: createTrainingPlan(221, dateFor(221)),
      athlete: DEFAULT_ATHLETE,
    });
    assert.equal(historical.kind, "reviewed");
    assert.equal(historical.plan.weekNumber, 40);
  } finally {
    d.close();
  }
});
test("weekly preparation and acceptance continue beyond week 30 with a stable anchor and bounded AI contexts", () => {
  const f = ready(53);
  try {
    const before = f.repo.plans().length,
      proposal = weeklyPlanning(f.d, f.now);
    assert.equal(proposal.selected.plan.weekNumber, 53);
    assert.equal(proposal.cycle?.phase, "performance");
    assert.equal(proposal.selected.plan.targetKm, 76);
    assert(proposal.needsApproval);
    assert(
      Buffer.byteLength(JSON.stringify(weeklyModelContext(proposal))) < 18000,
    );
    assert(
      Buffer.byteLength(JSON.stringify(coachContext(f.d, f.now).payload)) <
        24000,
    );
    acceptPreparedWeek(f.d, proposal.token, f.now);
    assert.equal(f.repo.plans().length, before + 1);
    assert.equal(weeklyPlanning(f.d, f.now).needsApproval, false);
    const next = weeklyPlanning(f.d, f.now, shiftDay(dateFor(53), 7));
    assert.equal(next.selected.plan.weekNumber, 54);
    assert(next.selected.plan.targetKm <= 80);
  } finally {
    f.d.close();
  }
});
test("higher ceilings remain locked before completed consolidation and cannot be saved from a forecast or arbitrary payload", () => {
  const d = db();
  try {
    const repo = new TrainingRepository(d);
    repo.savePlan(createTrainingPlan(1, anchor));
    const now = new Date("2026-11-17T12:00:00Z");
    health(d, now);
    const r = planningPolicyReview(d, 90, now);
    assert(!r.eligible);
    assert(r.reasons.some((s) => s.includes("consolidation")));
    assert.throws(() =>
      savePlanningPolicy(d, { ceilingKm: 90, token: r.token }, now),
    );
    assert.equal(planningPolicy(d).ceilingKm, 80);
    assert.equal(
      d
        .prepare<[], { n: number }>("SELECT count(*) n FROM planning_policy")
        .get()!.n,
      0,
    );
    assert.throws(() =>
      savePlanningPolicy(d, { ceilingKm: 100, token: r.token }, now),
    );
    assert.equal(repo.plans().length, 1);
  } finally {
    d.close();
  }
});
test("a higher reviewed ceiling grows gradually and repeats below its cap without changing saved workouts or targets", () => {
  const f = ready();
  try {
    const before = JSON.stringify(f.repo.plans()),
      r = planningPolicyReview(f.d, 90, f.now);
    assert(r.eligible, JSON.stringify(r.reasons));
    savePlanningPolicy(f.d, { ceilingKm: 90, token: r.token }, f.now);
    const policy = planningPolicy(f.d);
    assert.equal(policy.ceilingKm, 90);
    assert(policy.effectiveFrom);
    assert.equal(JSON.stringify(f.repo.plans()), before);
    const firstStage = milestoneForWeek(
      policy.effectiveFrom!,
      f.repo.plans(),
    ).stage;
    assert.deepEqual(
      Array.from(
        { length: 8 },
        (_, i) =>
          trainingCycle(
            firstStage + i,
            policy,
            shiftDay(policy.effectiveFrom!, 7 * i),
          ).km,
      ),
      [82, 84, 86, 69, 86, 88, 90, 72],
    );
    for (let i = 0; i < 52; i++) {
      const n = firstStage + i,
        start = shiftDay(policy.effectiveFrom!, 7 * i),
        p = createTrainingPlan(
          n,
          start,
          375,
          270,
          undefined,
          undefined,
          policy,
        );
      assert(p.targetKm <= 90);
      assert.equal(planKm(p), p.targetKm);
      assert.equal(p.tempoPace, 270);
      assert(savedPlanSchema.safeParse(p).success);
    }
    assert.equal(
      trainingCycle(firstStage, DEFAULT_PLANNING_POLICY, policy.effectiveFrom!)
        .ceilingKm,
      80,
    );
    assert.throws(() => createTrainingPlan(53, dateFor(53), 375, 270, 90));
  } finally {
    f.d.close();
  }
});
test("policy review rejects stale tokens, stale sync, pain, missing recent training, and changed workload without partial writes", () => {
  const f = ready();
  try {
    const r = planningPolicyReview(f.d, 85, f.now);
    assert(r.eligible);
    f.d
      .prepare(
        "UPDATE sync_state SET last_completed_at='2020-01-01T00:00:00.000Z'",
      )
      .run();
    assert.throws(
      () => savePlanningPolicy(f.d, { ceilingKm: 85, token: r.token }, f.now),
      /changed/,
    );
    const stale = planningPolicyReview(f.d, 85, f.now);
    assert(!stale.eligible);
    assert.equal(planningPolicy(f.d).ceilingKm, 80);
    health(f.d, f.now);
    new TrainingRepository(f.d).saveCheckIn({
      day: calendarDate(f.now),
      pain: 1,
      fatigue: 1,
      soreness: 1,
      notes: "",
    });
    assert(!planningPolicyReview(f.d, 90, f.now).eligible);
    assert.equal(
      f.d
        .prepare<[], { n: number }>("SELECT count(*) n FROM planning_policy")
        .get()!.n,
      0,
    );
  } finally {
    f.d.close();
  }
});
test("lowering an optional ceiling is always reviewable and approved future weeks remain exact", () => {
  const f = ready();
  try {
    const r = planningPolicyReview(f.d, 85, f.now);
    savePlanningPolicy(f.d, { ceilingKm: 85, token: r.token }, f.now);
    const p = planningPolicy(f.d),
      start = p.effectiveFrom!,
      stage = milestoneForWeek(start, f.repo.plans()).stage,
      approved = createTrainingPlan(
        stage,
        start,
        375,
        270,
        undefined,
        undefined,
        p,
      );
    f.repo.savePlan(approved);
    const before = structuredClone(approved);
    const lower = planningPolicyReview(f.d, 80, f.now);
    assert(lower.eligible);
    savePlanningPolicy(f.d, { ceilingKm: 80, token: lower.token }, f.now);
    assert.equal(planningPolicy(f.d).ceilingKm, 80);
    assert.deepEqual(
      f.repo.plans().find((p) => p.start === start),
      before,
    );
  } finally {
    f.d.close();
  }
});
test("races and breaks remain first-class constraints in ongoing weeks and never activate a higher ceiling", () => {
  const f = ready();
  try {
    const day = shiftDay(calendarDate(f.now), 6);
    new CommitmentRepository(f.d).saveRace({
      id: randomUUID(),
      name: "Future Sunday race",
      day,
      startTime: null,
      distanceKm: 10,
      terrain: "road",
      elevationGain: 0,
      expectedMinutes: 50,
      priority: "goal",
      status: "planned",
      createdAt: f.now.toISOString(),
      updatedAt: f.now.toISOString(),
    });
    assert(!planningPolicyReview(f.d, 90, f.now).eligible);
    const p = weeklyPlanning(f.d, f.now);
    assert.equal(p.selected.plan.weekNumber, 37);
    assert(p.selected.calendar.days[6].race);
    assert(p.selected.calendar.days.every((d) => d.sessions.length <= 2));
    assert.equal(planningPolicy(f.d).ceilingKm, 80);
  } finally {
    f.d.close();
  }
});
test("the 80 km phase is a forecast rather than automatic clearance after a year-long gap", () => {
  const d = db();
  try {
    new TrainingRepository(d).savePlan(createTrainingPlan(1, anchor));
    const now = new Date(dateFor(54) + "T12:00:00Z");
    health(d, now);
    const p = weeklyPlanning(d, now);
    assert.equal(p.selected.plan.weekNumber, 54);
    assert(p.selected.plan.targetKm < 40);
    assert(p.needsApproval);
    assert(!planningPolicyReview(d, 90, now).eligible);
    assert.equal(new TrainingRepository(d).plans().length, 1);
  } finally {
    d.close();
  }
});

test("an explicitly reviewed higher ceiling reaches the real weekly planner beyond 80km and still needs weekly acceptance", () => {
  const f = ready();
  try {
    const r = planningPolicyReview(f.d, 90, f.now);
    savePlanningPolicy(f.d, { ceilingKm: 90, token: r.token }, f.now);
    const current = weeklyPlanning(f.d, f.now);
    acceptPreparedWeek(f.d, current.token, f.now);
    const saved = f.repo.plans().find((p) => p.start === dateFor(37))!;
    for (const w of saved.workouts)
      addRun(
        f.d,
        shiftDay(saved.start, w.dayOffset),
        workoutKm(w, saved.easyPace),
      );
    const now = new Date(dateFor(38) + "T12:00:00.000Z");
    health(f.d, now);
    const next = weeklyPlanning(f.d, now);
    assert.equal(next.selected.plan.weekNumber, 38);
    assert.equal(next.selected.plan.targetKm, 82);
    assert.equal(next.selected.plan.policy?.ceilingKm, 90);
    assert.equal(next.selected.plan.tempoPace, 270);
    assert(next.needsApproval);
    acceptPreparedWeek(f.d, next.token, now);
    assert.equal(
      f.repo.plans().find((p) => p.start === dateFor(38))?.targetKm,
      82,
    );
    assert(Buffer.byteLength(JSON.stringify(weeklyModelContext(next))) < 18000);
  } finally {
    f.d.close();
  }
});
