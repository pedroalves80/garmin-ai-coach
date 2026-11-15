import { fitMileageWeek } from "../src/shared/fit-mileage-week";
import { calendarMileage } from "../src/shared/mileage";
import { weekPurpose } from "../src/shared/week-purpose";
import { longRunTerrain } from "../src/shared/trail-running";
import { raceRecoveryEvidence } from "../src/server/training/race-recovery";
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { migrateDatabase } from "../src/server/db/migrate";
import { CommitmentRepository } from "../src/server/training/commitment-repository";
import {
  updateCommitment,
  returnReady,
} from "../src/server/training/commitments";
import { TrainingRepository } from "../src/server/training/repository";
import {
  trainingCalendar,
  moveRunningDay,
  trainingEvidencePlans,
} from "../src/server/training/calendar";
import { coachContext } from "../src/server/coach/context";
import { CoachService } from "../src/server/coach/service";
import { AutomaticCoach } from "../src/server/coach/automatic";
import { scheduleProposal, workoutProposal } from "../src/server/coach/policy";
import {
  applyCommitments,
  pauseActive,
  pendingReturn,
  calendarGate,
  eventOnlyPlan,
  daysBetween,
} from "../src/shared/commitment-calendar";
import {
  createTrainingPlan,
  workoutKm,
  targetText,
} from "../src/shared/training-plan";
import {
  buildWeekSchedule,
  validateDaySessions,
  validateRunningSchedule,
  dayOffsetDate,
} from "../src/shared/weekly-schedule";
import { DEFAULT_TARGETS } from "../src/shared/types/athlete";
import {
  DEFAULT_WEEK_PREFERENCES,
  DEFAULT_PREFERENCES,
} from "../src/shared/types/schedule";
import { plannedMinutes, plannedEffort } from "../src/shared/planned-load";
import type {
  RaceEvent,
  TrainingPause,
  Commitments,
} from "../src/shared/types/commitments";
import type { ActivityMeasurement } from "../src/shared/types/metrics";
const now = new Date("2026-11-01T08:00:00Z"),
  today = "2026-11-01",
  stamp = now.toISOString();
function race(extra: Partial<RaceEvent> = {}): RaceEvent {
  return {
    id: randomUUID(),
    name: "PRIVATE RACE NAME",
    day: today,
    startTime: "09:00",
    distanceKm: 10,
    terrain: "road",
    elevationGain: 80,
    expectedMinutes: 50,
    priority: "goal",
    status: "planned",
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  };
}
function pause(extra: Partial<TrainingPause> = {}): TrainingPause {
  return {
    id: randomUUID(),
    start: "2026-10-30",
    end: null,
    reason: "illness",
    cancelled: false,
    resumeOn: null,
    returnReviewedAt: null,
    createdAt: stamp,
    ...extra,
  };
}
function fixture(date = now) {
  const db = new Database(":memory:");
  migrateDatabase(db);
  const repo = new TrainingRepository(db);
  repo.savePlan(createTrainingPlan(1, "2026-10-26"));
  repo.saveCheckIn({
    day: date.toISOString().slice(0, 10),
    fatigue: 1,
    soreness: 1,
    pain: 0,
    notes: "",
  });
  db.prepare(
    "INSERT INTO sync_state(provider,last_completed_at,updated_at) VALUES('garmin',?,?)",
  ).run(date.toISOString(), date.toISOString());
  return { db, repo, commitments: new CommitmentRepository(db) };
}
function preview(
  c: Commitments,
  start = "2026-10-26",
  options: Parameters<typeof applyCommitments>[4] = {
    today,
    returnReady: true,
  },
) {
  const plan = createTrainingPlan(1, start);
  return applyCommitments(
    buildWeekSchedule(plan, DEFAULT_WEEK_PREFERENCES, DEFAULT_PREFERENCES),
    plan,
    c,
    DEFAULT_TARGETS,
    options,
  );
}
function km(calendar: ReturnType<typeof preview>) {
  return calendarMileage(calendar, 375).countedKm;
}
function activity(id: string, day: string, km: number): ActivityMeasurement {
  return {
    id,
    name: null,
    sportType: "running",
    startedAt: `${day}T07:00:00Z`,
    distanceMeters: km * 1000,
    durationSeconds: km * 360,
    averageHeartRate: 140,
    rawJson: "{}",
  };
}

test("a Sunday road race replaces quality and long running inside the weekly budget", () => {
  const r = race(),
    cal = preview({ races: [r], pauses: [] });
  assert(km(cal) <= 25);
  const sunday = cal.days[6];
  assert.equal(sunday.sessions.length, 1);
  const s = sunday.sessions[0].session;
  assert(s.sport === "running");
  assert.equal(s.slot, "event");
  assert.equal(s.workout.type, "race");
  assert.equal(workoutKm(s.workout, 375), 11.5);
  assert.equal(cal.days[5].sessions.length, 0);
  assert(
    !cal.days
      .flatMap((d) => d.sessions)
      .some(
        (s) =>
          s.session.sport === "running" &&
          ["quality", "long", "strides"].includes(s.session.workout.type),
      ),
  );
  assert.equal(plannedMinutes(s, createTrainingPlan(1, "2026-10-26")), 59.375);
  assert.equal(plannedEffort(s), 8);
  assert.match(
    targetText({ kind: "effort", min: 7, max: 9 }),
    /Garmin target: none/,
  );
  validateDaySessions(6, [s], 375, r);
  assert.throws(() => validateDaySessions(6, [s], 375), /Sunday/);
  assert.throws(
    () =>
      validateRunningSchedule({
        ...createTrainingPlan(1, "2026-10-26"),
        workouts: [s.workout],
      }),
    /Sunday/,
  );
});
test("ordinary event slots cannot bypass Sunday or lunch rules", () => {
  const r = race(),
    s = {
      sport: "running" as const,
      slot: "event" as const,
      workout: createTrainingPlan(1, "2026-10-26").workouts[0],
    };
  assert.throws(() => validateDaySessions(0, [s], 375), /lunch/);
  assert.throws(
    () =>
      validateDaySessions(
        6,
        [{ ...s, workout: { ...s.workout, dayOffset: 6 } }],
        375,
        r,
      ),
    /Sunday/,
  );
});
test("17 km trail events reserve more recovery and do not add supporting sessions", () => {
  const r = race({
      distanceKm: 17,
      terrain: "trail",
      elevationGain: 800,
      expectedMinutes: 140,
    }),
    cal = preview({ races: [r], pauses: [] });
  assert(km(cal) <= 25);
  assert.equal(cal.days[6].sessions.length, 1);
  const after = preview({ races: [r], pauses: [] }, "2026-11-02");
  assert.equal(after.days[0].sessions.length, 0);
  assert.equal(after.days[1].sessions.length, 0);
  assert(
    after.days.every((d) =>
      d.sessions.every(
        (s) =>
          s.session.sport === "running" &&
          s.session.workout.type === "recovery",
      ),
    ),
  );
  assert(
    after.days.every((d) =>
      d.sessions.every(
        (s) =>
          s.session.sport !== "running" ||
          workoutKm(s.session.workout, 375) > 5,
      ),
    ),
  );
  assert(
    km(after) > 10,
    "Routine trail recovery is not capped at two 5 km runs",
  );
  assert(calendarGate({ races: [r], pauses: [] }, "2026-11-02").blocked);
});
test("races can occupy a weekday without duplicating a lunch run or later session", () => {
  const r = race({ day: "2026-10-29" }),
    cal = preview({ races: [r], pauses: [] });
  assert.equal(cal.days[3].sessions.length, 1);
  assert.equal(cal.days[3].sessions[0].session.slot, "event");
  assert.equal(cal.days[6].sessions.length, 0);
  assert(km(cal) <= 25);
});
test("breaks override races and retain recorded history", () => {
  const c = { races: [race()], pauses: [pause()] },
    cal = preview(c);
  assert.equal(cal.days[6].sessions.length, 0);
  assert.equal(cal.days[6].rule?.phase, "paused");
  assert(cal.days[6].warnings.some((w) => w.includes("conflicts")));
  const { db, repo, commitments } = fixture();
  commitments.savePause(pause());
  const plan = repo.plans()[0];
  const withHistory = trainingCalendar(
    db,
    plan,
    [activity("a", "2026-10-31", 5)],
    now,
  );
  assert.equal(withHistory.days[5].recorded.length, 1);
  assert(withHistory.days[5].sessions.every((s) => s.status === "recorded"));
  db.close();
});
test("a dated break does not resume automatically and a reviewed return preserves prior gap dates", () => {
  const p = pause({ end: "2026-10-31" });
  assert(!pauseActive(p, today));
  assert(pendingReturn(p, today));
  assert(
    preview({ races: [], pauses: [p] }).days[6].rule?.phase === "return_review",
  );
  const reviewed = { ...p, returnReviewedAt: "2026-11-03" };
  assert(pendingReturn(reviewed, today));
  assert(!pendingReturn(reviewed, "2026-11-03"));
  assert(calendarGate({ races: [], pauses: [reviewed] }, "2026-11-04").blocked);
});
test("return weeks contain only spaced recovery runs and no hidden 20 km minimum", () => {
  const p = pause({ end: "2026-11-01", returnReviewedAt: "2026-11-02" }),
    cal = preview({ races: [], pauses: [p] }, "2026-11-02", {
      today: "2026-11-02",
      returnReady: true,
    });
  assert(km(cal) < 20);
  assert(
    cal.days.every((d) =>
      d.sessions.every(
        (s) =>
          s.session.sport === "running" &&
          s.session.workout.type === "recovery" &&
          workoutKm(s.session.workout, 375) === 5,
      ),
    ),
  );
  for (let i = 1; i < 7; i++)
    assert(!(cal.days[i].sessions.length && cal.days[i - 1].sessions.length));
  const missing = preview({ races: [], pauses: [p] }, "2026-11-02", {
    today: "2026-11-02",
    returnReady: false,
  });
  assert.equal(missing.days[0].sessions.length, 0);
});
test("a race overlapping a return or another race's recovery stays recorded as a conflict", () => {
  const p = pause({ end: "2026-10-29", returnReviewedAt: "2026-10-30" });
  const cal = preview({ races: [race()], pauses: [p] });
  assert.equal(cal.days[6].rule?.phase, "return");
  assert.equal(cal.days[6].sessions.length, 0);
  assert(cal.days[6].race);
  const before = race({ day: "2026-10-30" });
  const overlap = preview({ races: [before, race()], pauses: [] });
  assert.equal(overlap.days[6].rule?.phase, "race_recovery");
  assert.equal(overlap.days[6].sessions.length, 0);
});
test("calendar mutations validate dates, preserve history and require a ready check-in to return", () => {
  const { db, commitments, repo } = fixture();
  const r = race({ day: "2027-06-13" });
  const fields = {
    name: r.name,
    day: r.day,
    startTime: r.startTime,
    distanceKm: r.distanceKm,
    terrain: r.terrain,
    elevationGain: r.elevationGain,
    expectedMinutes: r.expectedMinutes,
    priority: r.priority,
  };
  updateCommitment(db, { action: "race", race: fields }, now);
  assert.equal(commitments.all().races[0].day, r.day);
  assert.throws(
    () => updateCommitment(db, { action: "race", race: fields }, now),
    /already/,
  );
  assert.throws(
    () =>
      updateCommitment(
        db,
        { action: "race", race: { ...fields, day: dayOffsetDate(today, 731) } },
        now,
      ),
    /two years/,
  );
  assert.throws(
    () =>
      updateCommitment(
        db,
        { action: "race", race: { ...fields, day: "2026-10-31" } },
        now,
      ),
    /today/,
  );
  assert.equal(daysBetween(dayOffsetDate(today, 730), today), 730);
  updateCommitment(
    db,
    { action: "pause", pause: { start: today, end: null, reason: "travel" } },
    now,
  );
  const p = commitments.all().pauses[0];
  assert.throws(
    () => updateCommitment(db, { action: "cancel_pause", id: p.id }, now),
    /history/,
  );
  assert.throws(
    () => updateCommitment(db, { action: "review_return", id: p.id }, now),
    /End/,
  );
  updateCommitment(db, { action: "resume", id: p.id }, now);
  assert(pendingReturn(commitments.all().pauses[0], today));
  repo.saveCheckIn({ day: today, fatigue: 4, soreness: 1, pain: 0, notes: "" });
  assert(!returnReady(db, now));
  assert.throws(
    () => updateCommitment(db, { action: "review_return", id: p.id }, now),
    /check-in/,
  );
  repo.saveCheckIn({ day: today, fatigue: 1, soreness: 1, pain: 0, notes: "" });
  updateCommitment(db, { action: "review_return", id: p.id }, now);
  assert.equal(commitments.all().pauses[0].returnReviewedAt, today);
  db.close();
});
test("only future breaks can be cancelled; completed races cannot be future dated", () => {
  const { db, commitments } = fixture();
  updateCommitment(
    db,
    {
      action: "pause",
      pause: { start: "2026-11-10", end: "2026-11-13", reason: "rest" },
    },
    now,
  );
  const p = commitments.all().pauses[0];
  updateCommitment(db, { action: "cancel_pause", id: p.id }, now);
  assert(commitments.all().pauses[0].cancelled);
  const r = race({ day: "2026-12-06" });
  commitments.saveRace(r);
  assert.throws(
    () => updateCommitment(db, { action: "complete_race", id: r.id }, now),
    /Future/,
  );
  db.close();
});
test("the Sunday coach only follows or rests a fixed race and redacts private names", () => {
  const { db, commitments, repo } = fixture();
  const r = race();
  commitments.saveRace(r);
  const c = coachContext(db, now);
  assert.deepEqual(c.allowed, ["follow", "rest"]);
  assert(c.canSchedule);
  assert.equal(c.workout?.race?.id, r.id);
  assert(!JSON.stringify(c.payload).includes("PRIVATE RACE NAME"));
  assert.throws(() => workoutProposal(c, "today", "shorten"), /conflicts/);
  assert.throws(() => scheduleProposal(c, "today", "move_5"), /conflicts/);
  assert.equal(scheduleProposal(c, "today", "rest")[0].sessions.length, 0);
  assert.throws(
    () =>
      moveRunningDay(
        db,
        repo.plans()[0],
        6,
        5,
        [],
        new Date("2026-10-26T08:00:00Z"),
      ),
    /Run unavailable/,
  );
  commitments.saveRace({ ...r, name: "NEW PRIVATE NAME" });
  assert.notEqual(coachContext(db, now).hash, c.hash);
  repo.saveCheckIn({ day: today, fatigue: 1, soreness: 1, pain: 1, notes: "" });
  assert.deepEqual(coachContext(db, now).allowed, ["rest"]);
  db.close();
});
test("a race works without a saved running week and a warm-up does not count as the course", () => {
  const { db, commitments } = fixture();
  db.prepare("DELETE FROM training_plans").run();
  commitments.saveRace(race());
  let c = coachContext(db, now);
  assert(c.plan);
  assert.equal(c.plan.targetKm, 0);
  assert.equal(c.todaySchedule?.sessions.length, 1);
  assert.equal(c.payload.ranToday, false);
  const blank = eventOnlyPlan("2026-10-26", 375, 270);
  assert(
    buildWeekSchedule(
      blank,
      DEFAULT_WEEK_PREFERENCES,
      DEFAULT_PREFERENCES,
    ).days.every((d) => d.sessions.length === 0),
  );
  const cal = trainingCalendar(db, blank, [activity("warm", today, 1)], now);
  assert.equal(cal.days[6].sessions[0].status, "planned");
  db.prepare(
    "INSERT INTO activities(id,provider_activity_id,sport_type,started_at,distance_meters,duration_seconds,raw_json,imported_at) VALUES('warm','warm','running',?,1000,360,'{}',?)",
  ).run(`${today}T07:00:00Z`, stamp);
  c = coachContext(db, now);
  assert.equal(c.payload.ranToday, false);
  assert(c.allowed.includes("rest"));
  db.close();
});
test("races and breaks never become positive quality evidence; future commitments do not block unrelated weeks", () => {
  const { db, repo, commitments } = fixture();
  commitments.saveRace(race());
  assert.equal(trainingEvidencePlans(db, repo.plans(), [], now).length, 0);
  assert(
    !calendarGate(
      { races: [race({ day: "2027-06-13" })], pauses: [] },
      today,
      "2026-11-02",
    ).blocked,
  );
  assert(
    calendarGate(
      { races: [race({ day: "2027-06-13" })], pauses: [] },
      today,
      "2027-06-07",
    ).blocked,
  );
  db.close();
});
test("paused automatic coaching makes no provider request and approved race rest survives overlays", async () => {
  const { db, commitments } = fixture();
  commitments.saveRace(race());
  let calls = 0;
  const service = new CoachService(
    db,
    async () => {
      calls++;
      return {
        output: {
          summary: "Rest today.",
          observations: ["Recovery comes first."],
          action: "rest",
          reason: "Rest around the event.",
        },
        inputTokens: 100,
        outputTokens: 60,
      };
    },
    "test-model",
    () => now,
  );
  const review = await service.review("today");
  service.accept(review.review.id);
  assert.equal(
    trainingCalendar(db, createTrainingPlan(1, "2026-10-26"), [], now).days[6]
      .sessions.length,
    0,
  );
  assert.deepEqual(coachContext(db, now).allowed, ["follow"]);
  commitments.savePause(pause());
  const worker = new AutomaticCoach(db, service, true, () => now);
  assert.equal(await worker.tick(), "waiting");
  assert.equal(calls, 1);
  assert(!coachContext(db, now).canSchedule);
  db.close();
});
test("two existing records block extra racing without hiding activity history", () => {
  const { db, repo, commitments } = fixture();
  commitments.saveRace(race());
  const cal = trainingCalendar(
    db,
    repo.plans()[0],
    [activity("a", today, 1), activity("b", today, 1)],
    now,
  );
  assert.equal(cal.days[6].recorded.length, 2);
  assert.equal(cal.days[6].sessions[0].status, "blocked");
  db.close();
});

test("return restrictions persist after seven days until an explicit low-volume baseline review", () => {
  const later = new Date("2026-11-10T08:00:00Z"),
    { db, repo, commitments } = fixture(later),
    p = pause({ end: "2026-11-01", returnReviewedAt: "2026-11-02" });
  commitments.savePause(p);
  repo.savePlan(createTrainingPlan(1, "2026-11-09"));
  repo.savePlan(createTrainingPlan(2, "2026-11-16"));
  let cal = trainingCalendar(
    db,
    repo.plans().find((p) => p.start === "2026-11-09")!,
    [],
    later,
  );
  assert(cal.days.some((d) => d.rule?.phase === "return"));
  assert(
    cal.days.every((d) =>
      d.sessions.every((s) => s.session.sport === "running"),
    ),
  );
  assert.throws(
    () => updateCommitment(db, { action: "review_baseline", id: p.id }, later),
    /Record at least/,
  );
  for (const [id, day] of [
    ["a", "2026-11-02"],
    ["b", "2026-11-05"],
  ])
    db.prepare(
      "INSERT INTO activities(id,provider_activity_id,sport_type,started_at,distance_meters,duration_seconds,raw_json,imported_at) VALUES(?,?,'running',?,5000,1800,'{}',?)",
    ).run(id, id, `${day}T10:00:00Z`, later.toISOString());
  updateCommitment(db, { action: "review_baseline", id: p.id }, later);
  const baseline = repo.plans().find((p) => p.start === "2026-11-09")!;
  assert.equal(baseline.targetKm, 20);
  assert.equal(baseline.development?.phase, "recovery");
  assert(
    baseline.workouts.every(
      (w) => w.type !== "quality" && w.type !== "strides",
    ),
  );
  assert.equal(commitments.all().pauses[0].baselineReviewedAt, "2026-11-10");
  const history = trainingCalendar(
    db,
    createTrainingPlan(1, "2026-11-02"),
    [],
    later,
  );
  assert(history.days.some((d) => d.rule?.phase === "return"));
  assert.deepEqual(commitments.all().pauses[0].staleWeeks, ["2026-11-16"]);
  cal = trainingCalendar(
    db,
    repo.plans().find((p) => p.start === "2026-11-16")!,
    [],
    later,
  );
  assert(
    cal.days.every(
      (d) => d.sessions.length === 0 && d.rule?.phase === "return_review",
    ),
  );
  db.close();
});

test("marking a race completed never prescribes it again or invents Garmin confirmation", () => {
  const { db, repo, commitments } = fixture(),
    r = race({ status: "completed" });
  commitments.saveRace(r);
  let cal = trainingCalendar(db, repo.plans()[0], [], now);
  assert.equal(cal.days[6].sessions.length, 0);
  cal = trainingCalendar(
    db,
    repo.plans()[0],
    [activity("course", today, 10)],
    now,
  );
  assert.equal(cal.days[6].sessions[0].status, "recorded");
  assert(
    cal.days[6].sessions[0].session.sport === "running" &&
      cal.days[6].sessions[0].session.workout.type === "race",
  );
  db.close();
});

test("ordinary road recovery keeps existing distances after initial rest without a daily check-in", () => {
  const r = race({ priority: "training" });
  const after = preview({ races: [r], pauses: [] }, "2026-11-02", {
    today: "2026-11-05",
    returnReady: false,
  });
  const baseline = createTrainingPlan(1, "2026-11-02");
  assert.equal(after.days[0].sessions.length, 0);
  for (const offset of [1, 3, 5]) {
    const run = after.days[offset].sessions.find(
      (s) => s.session.sport === "running",
    )!.session;
    assert.ok(run.sport === "running");
    assert.equal(
      workoutKm(run.workout, 375),
      workoutKm(
        baseline.workouts.find((w) => w.dayOffset === offset)!,
        375,
      ),
    );
  }
  assert.equal(km(after), 20);
  assert.match(weekPurpose(after), /Race recovery/);
  assert.doesNotMatch(weekPurpose(after), /Build gradually/);
});

test("training events keep frequency and trim only excess distance inside the reviewed budget", () => {
  const plan = createTrainingPlan(11, "2026-11-02", 375, 270, 40);
  const event = race({ day: "2026-11-08", priority: "training" });
  const cal = applyCommitments(
    buildWeekSchedule(plan, DEFAULT_WEEK_PREFERENCES, DEFAULT_PREFERENCES),
    plan,
    { races: [event], pauses: [] },
    DEFAULT_TARGETS,
    { today: "2026-11-01", returnReady: false },
  );
  assert.equal(km(cal), 40);
  assert.equal(
    cal.days.filter((d) =>
      d.sessions.some((s) => s.session.sport === "running"),
    ).length,
    5,
  );
  assert(
    cal.days.some((d) =>
      d.rule?.notes.some(
        (n) => n.includes("allocated") || n.includes("Only the excess"),
      ),
    ),
  );
  assert.equal(calendarMileage(cal, 375).totalKm, 41.5);
  assert(cal.days.every((d) => d.sessions.length <= 2));
  for (const d of cal.days)
    validateDaySessions(
      d.dayOffset,
      d.sessions.map((s) => s.session),
      375,
      d.race,
    );
});

test("training preparation preserves distance and trail effort whereas explicit goal tapers can reduce distance", () => {
  const plan = createTrainingPlan(11, "2026-11-02", 375, 270, 40);
  const event = race({
    day: "2026-11-07",
    distanceKm: 5,
    expectedMinutes: 30,
    priority: "training",
    terrain: "trail",
    elevationGain: 100,
  });
  const base = buildWeekSchedule(
    plan,
    DEFAULT_WEEK_PREFERENCES,
    DEFAULT_PREFERENCES,
  );
  const cal = applyCommitments(
    base,
    plan,
    { races: [event], pauses: [] },
    DEFAULT_TARGETS,
    { today: "2026-11-01", returnReady: false },
  );
  const thu = (c: typeof cal) =>
    c.days[3].sessions.find((s) => s.session.sport === "running")!.session;
  const training = thu(cal);
  assert.ok(training.sport === "running");
  assert.equal(
    workoutKm(training.workout, 375),
    workoutKm(
      plan.workouts.find((w) => w.dayOffset === 3)!,
      375,
    ),
  );
  const goal = applyCommitments(
    base,
    plan,
    { races: [{ ...event, priority: "goal" }], pauses: [] },
    DEFAULT_TARGETS,
    { today: "2026-11-01", returnReady: false },
  );
  assert.match(
    weekPurpose(goal),
    /^Race week/,
    "A Saturday race stays a race week even with Sunday recovery",
  );
  const target = thu(goal);
  assert.ok(target.sport === "running");
  assert(workoutKm(target.workout, 375) < workoutKm(training.workout, 375));
  const trailPlan = {
    ...plan,
    workouts: plan.workouts.map((w) =>
      w.type === "long" ? longRunTerrain(w, "trail", 100, 250) : w,
    ),
  };
  const post = applyCommitments(
    buildWeekSchedule(trailPlan, DEFAULT_WEEK_PREFERENCES, DEFAULT_PREFERENCES),
    trailPlan,
    {
      races: [
        race({
          priority: "training",
          terrain: "trail",
          distanceKm: 17,
          expectedMinutes: 140,
        }),
      ],
      pauses: [],
    },
    DEFAULT_TARGETS,
    { today: "2026-11-01", returnReady: false },
  );
  const trail = post.days[5].sessions.find(
    (s) => s.session.sport === "running",
  )!.session;
  assert.ok(trail.sport === "running");
  assert(trail.workout.trail);
  assert.equal(trail.workout.trail.road, undefined);
  assert.deepEqual(
    trail.workout.steps[0].kind === "step" && trail.workout.steps[0].target,
    { kind: "effort", min: 2, max: 3 },
  );
});

test("race recovery concerns and major events still justify reductions, and missing reports stay unknown", () => {
  const { db, repo } = fixture(new Date("2026-11-05T12:00:00Z"));
  try {
    const date = new Date("2026-11-05T12:00:00Z");
    assert.deepEqual(raceRecoveryEvidence(db, date), {
      stopRunning: false,
      reasons: [],
    });
    repo.saveCheckIn({
      day: "2026-11-05",
      pain: 2,
      fatigue: 2,
      soreness: 2,
      notes: "",
    });
    const evidence = raceRecoveryEvidence(db, date);
    assert(evidence.stopRunning);
    assert(evidence.reasons.some((n) => n.includes("pain")));
    const cal = preview(
      {
        races: [
          race({ terrain: "trail", distanceKm: 17, expectedMinutes: 140 }),
        ],
        pauses: [],
      },
      "2026-11-02",
      {
        today: "2026-11-05",
        returnReady: false,
        raceRecovery: evidence,
      },
    );
    assert.equal(cal.days[3].sessions.length, 0);
    const wearable = preview({ races: [race()], pauses: [] }, "2026-11-02", {
      today: "2026-11-03",
      returnReady: false,
      raceRecovery: { stopRunning: false, reasons: ["Garmin recovery flag"] },
    });
    assert(wearable.days[1].rule?.notes.includes("Garmin recovery flag"));
    const major = preview(
      { races: [race({ distanceKm: 42.2, expectedMinutes: 250 })], pauses: [] },
      "2026-11-02",
    );
    assert(
      major.days[3].rule?.notes.some((n) =>
        n.includes("Major-event safeguard"),
      ),
    );
    for (const d of major.days)
      for (const e of d.sessions)
        if (e.session.sport === "running" && e.status === "planned")
          assert(workoutKm(e.session.workout, 375) <= 5);
  } finally {
    db.close();
  }
});

test("training race preparation keeps base targets instead of applying recovery HR to every run", () => {
  const plan = createTrainingPlan(3, "2026-11-16", 375, 270, 29);
  const event = race({
    day: "2026-11-22",
    priority: "training",
    terrain: "trail",
    distanceKm: 18,
    elevationGain: 900,
    expectedMinutes: 150,
  });
  const commitments = { races: [event], pauses: [] };
  const calendar = applyCommitments(
    buildWeekSchedule(plan, DEFAULT_WEEK_PREFERENCES, DEFAULT_PREFERENCES),
    plan,
    commitments,
    DEFAULT_TARGETS,
    { today: "2026-11-15", returnReady: false },
  );
  const fitted = fitMileageWeek(calendar, plan, commitments, {
    today: "2026-11-15",
    longestRecentKm: 8,
  });
  assert.equal(calendarMileage(fitted.calendar, 375).countedKm, 29);
  for (const d of fitted.calendar.days)
    for (const s of d.sessions) {
      if (s.session.sport !== "running" || s.session.workout.race) continue;
      assert.equal(s.session.workout.type, "base");
      assert(
        s.session.workout.steps.some(
          (step) =>
            step.kind === "step" &&
            step.target.kind === "hr" &&
            step.target.max === DEFAULT_TARGETS.baseMax,
        ),
      );
    }
});

test("redistributing race recovery mileage does not leak its HR ceiling past the recovery window", () => {
  const targets = {
    ...DEFAULT_TARGETS,
    baseMin: 136,
    baseMax: 149,
    recoveryMin: 124,
    recoveryMax: 139,
  };
  const plan = createTrainingPlan(6, "2026-12-07", 375, 270, 32);
  const event = race({ day: "2026-12-05", priority: "goal" });
  const commitments = { races: [event], pauses: [] };
  plan.development = {
    phase: "volume",
    qualityLevel: 0,
    reason: "Test",
    targets,
    reviewedAt: null,
  };
  const calendar = applyCommitments(
    buildWeekSchedule(plan, DEFAULT_WEEK_PREFERENCES, DEFAULT_PREFERENCES),
    plan,
    commitments,
    targets,
    { today: "2026-11-15", returnReady: false },
  );
  // Exercise the deficit-reallocation path, as happens after calendar removal.
  calendar.days[0].sessions = [];
  const fitted = fitMileageWeek(calendar, plan, commitments, {
    today: "2026-11-15",
    longestRecentKm: 9,
  });
  assert(fitted.rebalanced);
  assert.equal(calendarMileage(fitted.calendar, 375).countedKm, 32);
  let recovery = 0,
    base = 0;
  for (const d of fitted.calendar.days)
    for (const s of d.sessions) {
      if (s.session.sport !== "running") continue;
      const restricted = d.day <= "2026-12-08";
      if (restricted) recovery++;
      else base++;
      assert.equal(s.session.workout.type, restricted ? "recovery" : "base");
      assert.deepEqual(
        s.session.workout.steps[0].kind === "step" &&
          s.session.workout.steps[0].target,
        {
          kind: "hr",
          min: restricted ? targets.recoveryMin : targets.baseMin,
          max: restricted ? targets.recoveryMax : targets.baseMax,
        },
      );
    }
  assert(recovery > 0 && base > 0);
});

test("an actual demanding trail recovery week retains recovery targets on every redistributed run", () => {
  const plan = createTrainingPlan(4, "2026-11-23", 375, 270, 23);
  const event = race({
    day: "2026-11-22",
    priority: "training",
    terrain: "trail",
    distanceKm: 18,
    elevationGain: 900,
    expectedMinutes: 150,
  });
  const commitments = { races: [event], pauses: [] };
  const calendar = applyCommitments(
    buildWeekSchedule(plan, DEFAULT_WEEK_PREFERENCES, DEFAULT_PREFERENCES),
    plan,
    commitments,
    DEFAULT_TARGETS,
    { today: "2026-11-15", returnReady: false },
  );
  const fitted = fitMileageWeek(calendar, plan, commitments, {
    today: "2026-11-15",
    longestRecentKm: 8,
  });
  assert(fitted.rebalanced);
  assert.equal(calendarMileage(fitted.calendar, 375).countedKm, 23);
  assert.equal(fitted.calendar.days[0].sessions.length, 0);
  assert.equal(fitted.calendar.days[1].sessions.length, 0);
  for (const d of fitted.calendar.days)
    for (const s of d.sessions) {
      if (s.session.sport !== "running") continue;
      assert.equal(s.session.workout.type, "recovery");
      assert.deepEqual(
        s.session.workout.steps[0].kind === "step" &&
          s.session.workout.steps[0].target,
        { kind: "hr", min: 125, max: 140 },
      );
    }
});

test("race preparation and budget adjustments preserve an explicitly prescribed recovery run", () => {
  const plan = createTrainingPlan(11, "2026-11-02", 375, 270, 40);
  const event = race({
    day: "2026-11-08",
    priority: "training",
    distanceKm: 5,
    expectedMinutes: 30,
  });
  const base = buildWeekSchedule(
    plan,
    DEFAULT_WEEK_PREFERENCES,
    DEFAULT_PREFERENCES,
  );
  const run = base.days[5].sessions.find(
    (s) => s.session.sport === "running",
  )!.session;
  assert(run.sport === "running");
  run.workout = {
    ...run.workout,
    type: "recovery",
    title: "Explicit recovery",
    steps: [
      {
        kind: "step",
        name: "Run",
        amount: { kind: "distance", meters: 5000 },
        target: { kind: "hr", min: 125, max: 140 },
      },
    ],
  };
  const calendar = applyCommitments(
    base,
    plan,
    { races: [event], pauses: [] },
    DEFAULT_TARGETS,
    { today: "2026-11-01", returnReady: false },
  );
  const kept = calendar.days[5].sessions.find(
    (s) => s.session.sport === "running",
  )!.session;
  assert(kept.sport === "running");
  assert.equal(kept.workout.type, "recovery");
  assert.deepEqual(
    kept.workout.steps[0].kind === "step" && kept.workout.steps[0].target,
    { kind: "hr", min: 125, max: 140 },
  );
});
