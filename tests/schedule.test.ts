import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/server/db/migrate";
import { TrainingRepository } from "../src/server/training/repository";
import {
  ScheduleRepository,
  preferencesSchema,
} from "../src/server/training/schedule-repository";
import {
  trainingCalendar,
  moveRunningDay,
} from "../src/server/training/calendar";
import { createTrainingPlan, workoutKm } from "../src/shared/training-plan";
import {
  buildWeekSchedule,
  powerRange,
  validateDaySessions,
  validateRunningSchedule,
  cyclingWorkout,
  cyclingMinutes,
} from "../src/shared/weekly-schedule";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_WEEK_PREFERENCES,
  type TrainingSession,
} from "../src/shared/types/schedule";
import { coachContext } from "../src/server/coach/context";
import { CoachService } from "../src/server/coach/service";
import { AutomaticCoach } from "../src/server/coach/automatic";
import type { CoachAction } from "../src/shared/types/coach";
const now = new Date("2026-10-26T10:00:00Z");
function fixture() {
  const db = new Database(":memory:");
  migrateDatabase(db);
  const training = new TrainingRepository(db);
  const plan = createTrainingPlan(1, "2026-10-26");
  training.savePlan(plan);
  training.saveCheckIn({
    day: "2026-10-26",
    fatigue: 2,
    soreness: 2,
    pain: 0,
    notes: "PRIVATE NOTE",
  });
  db.prepare(
    "INSERT INTO sync_state(provider,last_completed_at,updated_at) VALUES('garmin',?,?)",
  ).run(now.toISOString(), now.toISOString());
  return { db, training, plan, repo: new ScheduleRepository(db) };
}
function service(
  db: Database.Database,
  action: CoachAction,
  clock = () => now,
  onCall = () => {},
) {
  return new CoachService(
    db,
    async () => {
      onCall();
      return {
        output: {
          summary: "Use the full weekly load.",
          observations: ["Running remains first."],
          action,
          reason: "Allow recovery.",
        },
        inputTokens: 1,
        outputTokens: 1,
      };
    },
    "test",
    clock,
  );
}

test("cycling minimum covers recovery, endurance, settings and older stored preferences", () => {
  const { db, repo } = fixture();
  db.prepare(
    "INSERT INTO training_preferences(id,settings_json) VALUES(1,?)",
  ).run(
    JSON.stringify({
      ...DEFAULT_PREFERENCES,
      ftpWatts: 205,
      weekdayCyclingMinutes: 45,
      saturdayCyclingMinutes: 30,
    }),
  );
  const prefs = repo.preferences();
  assert.equal(prefs.weekdayCyclingMinutes, 60);
  assert.equal(prefs.saturdayCyclingMinutes, 60);
  assert.equal(prefs.ftpWatts, 205);
  assert(
    !preferencesSchema.safeParse({ ...prefs, weekdayCyclingMinutes: 59 })
      .success,
  );
  assert(
    !preferencesSchema.safeParse({ ...prefs, saturdayCyclingMinutes: 59 })
      .success,
  );
  for (const effort of ["recovery", "endurance"] as const) {
    const ride = cyclingWorkout(prefs, effort, 30);
    assert.equal(cyclingMinutes(ride), 60);
    assert.deepEqual(
      ride.steps.map((s) => s.minutes),
      [5, 50, 5],
    );
    assert.equal(cyclingMinutes(cyclingWorkout(prefs, effort, 90)), 90);
    const short = {
      ...ride,
      steps: ride.steps.map((s) =>
        s.name === "Ride" ? { ...s, minutes: 49 } : s,
      ),
    };
    assert.throws(
      () =>
        validateDaySessions(
          1,
          [{ sport: "cycling", slot: "later", workout: short }],
          375,
        ),
      /at least 60/,
    );
  }
  db.close();
});
test("older saved rides upgrade in the calendar and AI recovery rides use the minimum", async () => {
  const { db, repo, plan } = fixture();
  const base = cyclingWorkout(DEFAULT_PREFERENCES, "recovery", 60);
  const short = {
    ...base,
    steps: base.steps.map((s) =>
      s.name === "Ride" ? { ...s, minutes: 35 } : s,
    ),
  };
  repo.saveChanges(
    [
      {
        day: "2026-10-27",
        sessions: [
          {
            sport: "running",
            slot: "lunch",
            workout: plan.workouts.find((w) => w.dayOffset === 1)!,
          },
          { sport: "cycling", slot: "later", workout: short },
        ],
      },
    ],
    null,
  );
  const next = trainingCalendar(db, plan, [], now).days[1];
  const bike = next.sessions.find(
    (s) => s.session.sport === "cycling",
  )!.session;
  assert(bike.sport === "cycling");
  assert.equal(cyclingMinutes(bike.workout), 60);
  assert.deepEqual(
    bike.workout.steps.map((s) => [s.minPercent, s.maxPercent]),
    short.steps.map((s) => [s.minPercent, s.maxPercent]),
  );
  assert.equal(next.sessions.length, 2);
  const { review } = await service(db, "cycle").review("today");
  const proposed = review.scheduleChanges![0].sessions.find(
    (s) => s.sport === "cycling",
  )!;
  assert(proposed.sport === "cycling");
  assert.equal(cyclingMinutes(proposed.workout), 60);
  assert.equal(
    coachContext(db, now).payload.workoutPreferences.minimumCyclingMinutes,
    60,
  );
  db.close();
});
test("all Hyrox combinations preserve runs, cap two sessions and reserve Sunday", () => {
  const plan = createTrainingPlan(1, "2026-10-26");
  for (let mask = 0; mask < 8; mask++) {
    const week = structuredClone(DEFAULT_WEEK_PREFERENCES);
    (["monday", "wednesday", "friday"] as const).forEach(
      (key, i) => (week.hyrox[key] = mask & (1 << i) ? "going" : "skipping"),
    );
    const calendar = buildWeekSchedule(plan, week, DEFAULT_PREFERENCES);
    assert.equal(calendar.days[6].sessions.length, 0);
    assert.equal(
      calendar.days.flatMap((d) =>
        d.sessions.filter((s) => s.session.sport === "running"),
      ).length,
      4,
    );
    for (const day of calendar.days) {
      assert(day.sessions.length <= 2);
      assert.equal(
        new Set(day.sessions.map((s) => s.session.slot)).size,
        day.sessions.length,
      );
      for (const s of day.sessions)
        if (s.session.sport === "hyrox")
          assert([0, 2, 4].includes(day.dayOffset));
    }
    for (const [index, key] of [
      [0, "monday"],
      [2, "wednesday"],
      [4, "friday"],
    ] as const)
      assert.equal(
        calendar.days[index].sessions.some((s) => s.session.sport === "hyrox"),
        week.hyrox[key] === "going",
      );
  }
});
test("FTP176 produces exact Zwift watt ranges and completed sessions block a third", () => {
  assert.deepEqual(powerRange(176, 45, 55), { min: 80, max: 96 });
  assert.deepEqual(powerRange(176, 56, 70), { min: 99, max: 123 });
  const plan = createTrainingPlan(1, "2026-10-26");
  const calendar = buildWeekSchedule(
    plan,
    DEFAULT_WEEK_PREFERENCES,
    DEFAULT_PREFERENCES,
    [],
    [
      { day: plan.start, sport: "running", minutes: 30, km: 5 },
      { day: plan.start, sport: "other", minutes: 20, km: 0 },
    ],
  );
  assert.equal(calendar.days[0].sessions[0].status, "recorded");
  assert.equal(calendar.days[0].sessions[1].status, "blocked");
});
test("run moves preserve weekly distance and reject Sunday, occupied days and weekday runs over120min", () => {
  const { db, plan, repo } = fixture();
  const original = trainingCalendar(db, plan, [], now);
  const changes = moveRunningDay(db, plan, 0, 2, [], now);
  repo.saveChanges(changes, null);
  const next = trainingCalendar(db, plan, [], now);
  const total = (days: typeof next.days) =>
    days
      .flatMap((d) => d.sessions)
      .reduce(
        (sum, s) =>
          sum +
          (s.session.sport === "running"
            ? workoutKm(s.session.workout, plan.easyPace)
            : 0),
        0,
      );
  assert.equal(total(next.days), total(original.days));
  assert(!next.days[0].sessions.some((s) => s.session.sport === "running"));
  assert(next.days[2].sessions.some((s) => s.session.sport === "running"));
  assert.throws(() => moveRunningDay(db, plan, 2, 6, [], now), /Monday/);
  assert.throws(
    () => moveRunningDay(db, plan, 2, 1, [], now),
    /without another run/,
  );
  const huge = createTrainingPlan(30, plan.start, 600, 270, 80);
  assert.throws(() => validateRunningSchedule(huge), /two-hour/);
  const bike: TrainingSession = {
    sport: "cycling",
    slot: "later",
    workout: cyclingWorkout(DEFAULT_PREFERENCES, "endurance", 180),
  };
  assert.doesNotThrow(() => validateDaySessions(0, [bike], 375));
  assert.throws(() => validateDaySessions(6, [bike], 375), /Sunday/);
  assert.throws(
    () => validateDaySessions(0, [{ ...bike, slot: "lunch" }], 375),
    /two hours/,
  );
  db.close();
});
test("AI cycle replaces only Hyrox, requires approval and keeps the run", async () => {
  const { db, plan } = fixture();
  const coach = service(db, "cycle");
  assert(coachContext(db, now).allowed.includes("cycle"));
  const { review } = await coach.review("today");
  assert.equal(review.proposal, null);
  assert(review.scheduleChanges?.length);
  assert.equal(
    trainingCalendar(db, plan, [], now).days[0].sessions[1].session.sport,
    "hyrox",
  );
  coach.accept(review.id);
  const day = trainingCalendar(db, plan, [], now).days[0];
  assert.deepEqual(
    day.sessions.map((s) => s.session.sport),
    ["running", "cycling"],
  );
  const run = day.sessions[0].session;
  assert(run.sport === "running");
  assert.equal(workoutKm(run.workout, 375), workoutKm(plan.workouts[0], 375));
  assert.deepEqual(coach.accept(review.id), { saved: true });
  db.close();
});
test("AI moving a run is a two-date preview and attendance/FTP changes invalidate approval", async () => {
  for (const changed of ["none", "attendance", "ftp"]) {
    const { db, plan, repo } = fixture();
    const coach = service(db, "move_2");
    const { review } = await coach.review("today");
    assert.equal(review.scheduleChanges?.length, 2);
    if (changed === "attendance")
      repo.saveWeek(plan.start, {
        ...DEFAULT_WEEK_PREFERENCES,
        hyrox: { monday: "skipping", wednesday: "going", friday: "undecided" },
      });
    if (changed === "ftp")
      repo.savePreferences({ ...DEFAULT_PREFERENCES, ftpWatts: 190 });
    if (changed !== "none")
      assert.throws(() => coach.accept(review.id), /changed/);
    else {
      coach.accept(review.id);
      const days = trainingCalendar(db, plan, [], now).days;
      assert(!days[0].sessions.some((s) => s.session.sport === "running"));
      assert(days[2].sessions.some((s) => s.session.sport === "running"));
    }
    db.close();
  }
});
test("pain removes all remaining sessions; secondary-only days can change without inventing a run", async () => {
  const { db, plan, training } = fixture();
  training.saveCheckIn({
    day: plan.start,
    fatigue: 2,
    soreness: 2,
    pain: 1,
    notes: "",
  });
  const coach = service(db, "rest");
  const { review } = await coach.review("today");
  coach.accept(review.id);
  assert.equal(trainingCalendar(db, plan, [], now).days[0].sessions.length, 0);
  db.close();
  const next = fixture(),
    wed = new Date("2026-10-28T10:00:00Z");
  next.training.saveCheckIn({
    day: "2026-10-28",
    fatigue: 2,
    soreness: 2,
    pain: 0,
    notes: "",
  });
  next.db
    .prepare("UPDATE sync_state SET last_completed_at=?")
    .run(wed.toISOString());
  const secondary = service(next.db, "cycle", () => wed);
  const result = await secondary.review("today");
  assert.equal(result.review.proposal, null);
  secondary.accept(result.review.id);
  const sessions = trainingCalendar(next.db, next.plan, [], wed).days[2]
    .sessions;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].session.sport, "cycling");
  next.db.close();
});
test("new fatigue supersedes earlier approval and can cancel later training after a recorded run", async () => {
  const { db, training, plan } = fixture();
  const coach = service(db, "cycle");
  const { review } = await coach.review("today");
  coach.accept(review.id);
  training.saveCheckIn({
    day: plan.start,
    fatigue: 4,
    soreness: 2,
    pain: 0,
    notes: "",
  });
  assert.deepEqual(coachContext(db, now).allowed, ["rest"]);
  db.prepare(
    "INSERT INTO activities(id,provider_activity_id,sport_type,started_at,raw_json,imported_at) VALUES('run','run','running','2026-10-26T09:00:00Z','{}',?)",
  ).run(now.toISOString());
  const context = coachContext(db, now);
  assert(context.allowed.includes("skip_secondary"));
  assert(!context.allowed.includes("cycle"));
  const skip = service(db, "skip_secondary");
  const next = await skip.review("today");
  skip.accept(next.review.id);
  const sessions = trainingCalendar(db, plan, [], now).days[0].sessions;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].session.sport, "running");
  db.close();
});
test("automatic coach claims once per day across restarts, waits for data and honors preferences/budgets", async () => {
  const { db, training, repo } = fixture();
  let calls = 0;
  const coach = service(
    db,
    "follow",
    () => now,
    () => {
      calls++;
    },
  );
  const worker = () => new AutomaticCoach(db, coach, true, () => now);
  db.prepare("DELETE FROM daily_check_ins").run();
  assert.equal(await worker().tick(), "waiting");
  assert.equal(calls, 0);
  training.saveCheckIn({
    day: "2026-10-26",
    fatigue: 2,
    soreness: 2,
    pain: 0,
    notes: "",
  });
  assert.equal(await worker().tick(), "reviewed");
  assert.equal(await worker().tick(), "done");
  assert.equal(calls, 1);
  assert.equal(repo.changes("2026-10-26").length, 0);
  repo.savePreferences({ ...DEFAULT_PREFERENCES, automaticCoach: false });
  assert.equal(await worker().tick(), "disabled");
  repo.savePreferences(DEFAULT_PREFERENCES);
  const sunday = new Date("2026-11-01T10:00:00Z");
  training.saveCheckIn({
    day: "2026-11-01",
    fatigue: 2,
    soreness: 2,
    pain: 0,
    notes: "",
  });
  db.prepare("UPDATE sync_state SET last_completed_at=?").run(
    sunday.toISOString(),
  );
  assert.equal(
    await new AutomaticCoach(
      db,
      service(db, "follow", () => sunday),
      true,
      () => sunday,
    ).tick(),
    "waiting",
  );
  assert.deepEqual(coachContext(db, sunday).allowed, ["follow"]);
  db.close();
  const limited = fixture();
  for (let i = 0; i < 6; i++)
    limited.db
      .prepare(
        "INSERT INTO coach_requests(id,day,created_at,finished) VALUES(?,?,?,1)",
      )
      .run(`budget${i}`, "2026-10-26", now.toISOString());
  assert.equal(
    await new AutomaticCoach(
      limited.db,
      service(limited.db, "follow"),
      true,
      () => now,
    ).tick(),
    "limited",
  );
  assert.equal(
    limited.db.prepare("SELECT * FROM automatic_coach").all().length,
    0,
  );
  limited.db.close();
});
test("failed automatic review is not retried every tick or on a worker restart", async () => {
  const { db } = fixture();
  let calls = 0;
  const coach = new CoachService(
    db,
    async () => {
      calls++;
      throw new Error("PRIVATE PROVIDER");
    },
    "test",
    () => now,
  );
  assert.equal(
    await new AutomaticCoach(db, coach, true, () => now).tick(),
    "failed",
  );
  assert.equal(
    await new AutomaticCoach(db, coach, true, () => now).tick(),
    "done",
  );
  assert.equal(calls, 1);
  assert.equal(coach.status(true).dailyUsed, 1);
  assert(!coach.status(true).automatic?.error?.includes("PRIVATE"));
  db.close();
});
