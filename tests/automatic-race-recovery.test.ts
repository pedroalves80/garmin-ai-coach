import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { migrateDatabase } from "../src/server/db/migrate";
import { TrainingRepository } from "../src/server/training/repository";
import { CommitmentRepository } from "../src/server/training/commitment-repository";
import { ScheduleRepository } from "../src/server/training/schedule-repository";
import { GarminRepository } from "../src/server/db/garmin-repository";
import { trainingCalendar } from "../src/server/training/calendar";
import { assessRaceRecoveries } from "../src/server/training/automatic-race-recovery";
import { automaticBaseReturn, raceRevision } from "../src/shared/race-policy";
import { createTrainingPlan } from "../src/shared/training-plan";
import { aerobicDistanceSteps } from "../src/shared/running-steps";
import { DEFAULT_TARGETS } from "../src/shared/types/athlete";
import {
  DEFAULT_WEEK_PREFERENCES,
  DEFAULT_PREFERENCES,
} from "../src/shared/types/schedule";
import {
  buildWeekSchedule,
  cyclingMinutes,
} from "../src/shared/weekly-schedule";
import { calendarMileage } from "../src/shared/mileage";
import {
  recordPrescriptionCalendar,
  prescriptionSnapshots,
} from "../src/server/training/prescription-snapshots";
import { captureUpcomingWorkouts } from "../src/server/training/review-capture";
import { workoutReviews } from "../src/server/training/workout-reviews";
import { coachContext } from "../src/server/coach/context";
import { weeklyPlanning } from "../src/server/training/weekly-planning";
import { weeklyModelContext } from "../src/server/coach/weekly";
import type {
  ActivityMeasurement,
  TrainingPlan,
  RunWorkout,
} from "../src/shared/types/metrics";
import type { RaceEvent } from "../src/shared/types/commitments";

const now = new Date("2026-11-27T08:00:00Z"),
  start = "2026-11-23";
function fixture() {
  const db = new Database(":memory:");
  migrateDatabase(db);
  const repo = new TrainingRepository(db),
    events = new CommitmentRepository(db);
  const race: RaceEvent = {
    id: randomUUID(),
    name: "PRIVATE TRAIL",
    day: "2026-11-22",
    startTime: "08:00",
    distanceKm: 16,
    terrain: "trail",
    elevationGain: 650,
    expectedMinutes: 140,
    priority: "training",
    status: "planned",
    createdAt: "2026-11-01T12:00:00Z",
    updatedAt: "2026-11-01T12:00:00Z",
  };
  events.saveRace(race);
  const workouts: RunWorkout[] = [2, 3, 5].map((dayOffset, i) => ({
    dayOffset,
    title: "Post-race recovery",
    type: "recovery",
    steps: aerobicDistanceSteps(
      i === 0 ? 7660 : 7670,
      { kind: "hr", min: 125, max: 140 },
      DEFAULT_TARGETS,
    ),
  }));
  const plan: TrainingPlan = {
    ...createTrainingPlan(4, start),
    planningVersion: 2,
    workouts,
  };
  repo.savePlan(plan);
  recordPrescriptionCalendar(
    db,
    buildWeekSchedule(plan, DEFAULT_WEEK_PREFERENCES, DEFAULT_PREFERENCES),
    375,
    new Date("2026-11-23T08:00:00Z"),
    "approved",
    start,
  );
  const insert = (
    id: string,
    day: string,
    extra: Partial<ActivityMeasurement> = {},
  ) => {
    const a: ActivityMeasurement = {
      id,
      name: null,
      sportType: "running",
      startedAt: day + "T12:00:00Z",
      distanceMeters: id === "wed" ? 7660 : 7670,
      durationSeconds: 2800,
      averageHeartRate: 138,
      rawJson: "{}",
      ...extra,
    };
    db.prepare(
      "INSERT INTO activities(id,provider_activity_id,sport_type,name,started_at,duration_seconds,distance_meters,average_heart_rate,raw_json,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      a.id,
      a.id,
      a.sportType,
      a.name,
      a.startedAt,
      a.durationSeconds,
      a.distanceMeters,
      a.averageHeartRate,
      a.rawJson,
      now.toISOString(),
    );
    return a;
  };
  insert("race", race.day, {
    sportType: "trail_running",
    distanceMeters: 15800,
    durationSeconds: 8100,
    averageHeartRate: 170,
  });
  insert("wed", "2026-11-25");
  insert("thu", "2026-11-26");
  for (let i = 0; i < 21; i++) {
    const day = new Date(Date.parse("2026-11-07T12:00:00Z") + i * 86400000)
      .toISOString()
      .slice(0, 10);
    db.prepare(
      "INSERT INTO daily_health(id,day,sleep_seconds,resting_heart_rate,raw_json,imported_at) VALUES(?,?,28800,50,'{}',?)",
    ).run(day, day, now.toISOString());
  }
  const sync = (stamp = now.toISOString()) =>
    db
      .prepare(
        "INSERT OR REPLACE INTO sync_state(provider,last_completed_at,updated_at) VALUES('garmin',?,?)",
      )
      .run(stamp, stamp);
  sync();
  const activities = () => new GarminRepository(db).allActivities();
  const assess = (at = now) =>
    assessRaceRecoveries(db, events.all(), activities(), at).races.find(
      (r) => r.id === race.id,
    )!;
  const calendar = (at = now) => trainingCalendar(db, plan, activities(), at);
  return {
    db,
    repo,
    events,
    race,
    plan,
    insert,
    sync,
    activities,
    assess,
    calendar,
  };
}
const mainMax = (w: RunWorkout) =>
  w.steps
    .filter((s) => s.kind === "step" && s.name === "Run")
    .map((s) =>
      s.kind === "step" && s.target.kind === "hr" ? s.target.max : null,
    );

test("two completed recovery days plus supportive overnight Garmin data automatically restore only existing base effort", () => {
  const f = fixture();
  try {
    const before = JSON.stringify(f.repo.plans()),
      r = f.assess(),
      a = r.automaticRecovery!;
    assert.equal(a.status, "base");
    assert.equal(a.recoveryRuns, 2);
    assert.equal(a.healthDay, "2026-11-27");
    assert.equal(a.paceComparison, "unavailable");
    assert(automaticBaseReturn(r, "2026-11-28", "2026-11-27"));
    assert(!automaticBaseReturn(r, "2026-11-26", "2026-11-27"));
    assert(!automaticBaseReturn(r, "2026-11-28", "2026-11-28"));
    const cal = f.calendar(),
      sat = cal.days[5];
    const run = sat.sessions.find(
      (s) => s.session.sport === "running",
    )!.session;
    assert(run.sport === "running");
    assert.deepEqual(mainMax(run.workout), [148]);
    assert.equal(run.workout.type, "base");
    assert.equal(sat.rule?.recoverySource, "automatic");
    assert.equal(calendarMileage(cal, 375).countedKm, 23);
    assert(
      cal.days.every((d) =>
        d.sessions.every((s) => s.session.sport !== "hyrox"),
      ),
    );
    assert.equal(cal.days[6].sessions.length, 0);
    assert(
      sat.sessions
        .filter((s) => s.session.sport === "cycling")
        .every(
          (s) =>
            s.session.sport === "cycling" &&
            cyclingMinutes(s.session.workout) === 60,
        ),
    );
    assert.equal(JSON.stringify(f.repo.plans()), before);
    assert(!f.events.all().races[0].recoveryReview);
    assert(!f.events.all().races[0].automaticRecovery);
    assert.equal(
      (
        f.db.prepare("SELECT count(*) n FROM daily_check_ins").get() as {
          n: number;
        }
      ).n,
      0,
    );
  } finally {
    f.db.close();
  }
});

test("initial rest, one run, same-day duplicates, unfinished runs and missing HR cannot authorize automatic base", () => {
  const edits = [
    (f: ReturnType<typeof fixture>) =>
      f.db.prepare("DELETE FROM activities WHERE id='thu'").run(),
    (f: ReturnType<typeof fixture>) =>
      f.db
        .prepare(
          "UPDATE activities SET started_at='2026-11-25T14:00:00Z' WHERE id='thu'",
        )
        .run(),
    (f: ReturnType<typeof fixture>) =>
      f.db
        .prepare(
          "UPDATE activities SET started_at='2026-11-27T07:50:00Z' WHERE id='thu'",
        )
        .run(),
    (f: ReturnType<typeof fixture>) =>
      f.db
        .prepare("UPDATE activities SET average_heart_rate=NULL WHERE id='thu'")
        .run(),
    (f: ReturnType<typeof fixture>) =>
      f.db
        .prepare("UPDATE activities SET average_heart_rate=160 WHERE id='thu'")
        .run(),
    (f: ReturnType<typeof fixture>) =>
      f.db
        .prepare("UPDATE activities SET distance_meters=4000 WHERE id='thu'")
        .run(),
    (f: ReturnType<typeof fixture>) =>
      f.db
        .prepare(
          "UPDATE activities SET sport_type='trail_running' WHERE id='thu'",
        )
        .run(),
    (f: ReturnType<typeof fixture>) =>
      f.db
        .prepare(
          "UPDATE workout_prescriptions SET captured_at='2026-11-27T00:00:00Z'",
        )
        .run(),
  ];
  for (const edit of edits) {
    const f = fixture();
    try {
      edit(f);
      assert.equal(f.assess().automaticRecovery?.status, "recovery");
    } finally {
      f.db.close();
    }
  }
  const f = fixture();
  try {
    assert.equal(
      f.assess(new Date("2026-11-23T12:00:00Z")).automaticRecovery?.status,
      "recovery",
    );
  } finally {
    f.db.close();
  }
});

test("fresh data must include overnight recovery after the latest completed run, not only an older median", () => {
  for (const sql of [
    "DELETE FROM daily_health WHERE day='2026-11-27'",
    "UPDATE daily_health SET sleep_seconds=18000 WHERE day='2026-11-27'",
    "UPDATE daily_health SET resting_heart_rate=60 WHERE day='2026-11-27'",
    "UPDATE daily_health SET resting_heart_rate=NULL WHERE day='2026-11-27'",
    "DELETE FROM daily_health WHERE day<'2026-11-24'",
  ]) {
    const f = fixture();
    try {
      f.db.exec(sql);
      assert.equal(f.assess().automaticRecovery?.status, "recovery", sql);
    } finally {
      f.db.close();
    }
  }
  for (const stamp of ["2026-11-24T00:00:00Z", "2026-11-28T00:00:00Z"]) {
    const f = fixture();
    try {
      f.sync(stamp);
      assert.equal(f.assess().automaticRecovery?.status, "recovery");
    } finally {
      f.db.close();
    }
  }
});

test("pain, harder feedback, moderate fatigue and recent demanding support revoke automatic base without daily reporting", () => {
  for (const kind of [
    "pain",
    "fatigue",
    "soreness",
    "oldPain",
    "feedback",
    "hard",
    "hyrox",
  ]) {
    const f = fixture();
    try {
      assert.equal(f.assess().automaticRecovery?.status, "base");
      if (["pain", "fatigue", "soreness", "oldPain"].includes(kind))
        f.repo.saveCheckIn({
          day: kind === "oldPain" ? "2026-11-23" : "2026-11-27",
          pain: kind.includes("Pain") || kind === "pain" ? 1 : 0,
          fatigue: kind === "fatigue" ? 3 : 1,
          soreness: kind === "soreness" ? 3 : 1,
          notes: "",
        });
      if (kind === "feedback")
        f.db
          .prepare(
            "INSERT INTO activity_feedback(activity_id,feeling,updated_at) VALUES('thu','harder',?)",
          )
          .run(now.toISOString());
      if (kind === "hard")
        f.db
          .prepare(
            "INSERT INTO session_efforts(activity_id,rpe,updated_at) VALUES('thu',6,?)",
          )
          .run(now.toISOString());
      if (kind === "hyrox")
        f.insert("class", "2026-11-26", {
          sportType: "strength_training",
          name: "Hyrox",
          durationSeconds: 3600,
          distanceMeters: 0,
          averageHeartRate: 140,
        });
      assert.equal(f.assess().automaticRecovery?.status, "recovery", kind);
      if (kind === "oldPain") {
        f.repo.saveCheckIn({
          day: "2026-11-27",
          pain: 0,
          fatigue: 1,
          soreness: 1,
          notes: "",
        });
        assert.equal(f.assess().automaticRecovery?.status, "base");
      }
    } finally {
      f.db.close();
    }
  }
});

test("major or unmatched races, later races and break-return rules do not gain an automatic clearance", () => {
  for (const kind of [
    "major",
    "duration",
    "missing",
    "later",
    "pause",
    "return",
  ]) {
    const f = fixture();
    try {
      if (kind === "major") f.events.saveRace({ ...f.race, distanceKm: 42 });
      if (kind === "duration")
        f.db
          .prepare(
            "UPDATE activities SET duration_seconds=14400 WHERE id='race'",
          )
          .run();
      if (kind === "missing")
        f.db.prepare("DELETE FROM activities WHERE id='race'").run();
      if (kind === "later") {
        const r = {
          ...f.race,
          id: randomUUID(),
          day: "2026-11-25",
          distanceKm: 5,
          terrain: "road" as const,
          elevationGain: 0,
          expectedMinutes: 30,
          status: "completed" as const,
        };
        f.events.saveRace(r);
      }
      if (kind === "pause" || kind === "return")
        f.events.savePause({
          id: randomUUID(),
          start: "2026-11-24",
          end: kind === "return" ? "2026-11-25" : null,
          reason: "illness",
          cancelled: false,
          resumeOn: null,
          returnReviewedAt: kind === "return" ? "2026-11-26" : null,
          baselineReviewedAt: null,
          createdAt: now.toISOString(),
        });
      assert.equal(f.assess().automaticRecovery?.status, "recovery", kind);
    } finally {
      f.db.close();
    }
  }
});

test("explicit day edits retain their lower target while other upcoming days can reassess", () => {
  const f = fixture();
  try {
    const schedule = new ScheduleRepository(f.db);
    schedule.saveChanges(
      [
        {
          day: "2026-11-28",
          sessions: [
            { sport: "running", slot: "lunch", workout: f.plan.workouts[2] },
          ],
        },
      ],
      null,
    );
    f.db
      .prepare(
        "INSERT INTO schedule_edit_history(id,created_at,summary,reason,days_json,before_json,after_json,context_json) VALUES(?,?,?,'tired',?,'{}','{}','{}')",
      )
      .run(
        randomUUID(),
        now.toISOString(),
        "Keep recovery",
        JSON.stringify(["2026-11-28"]),
      );
    assert.equal(f.assess().automaticRecovery?.status, "base");
    const run = f
      .calendar()
      .days[5].sessions.find((s) => s.session.sport === "running")!.session;
    assert(run.sport === "running");
    assert.deepEqual(mainMax(run.workout), [140]);
  } finally {
    f.db.close();
  }
});

test("automatically changed prescriptions are versioned, reversible for new concerns, and preserved at recorded activity start", () => {
  const f = fixture();
  try {
    const old = prescriptionSnapshots(f.db).length;
    captureUpcomingWorkouts(f.db, now);
    const base = prescriptionSnapshots(f.db)
      .filter((s) => s.day === "2026-11-28")
      .at(-1)!;
    assert(base.workout?.title.includes("automatically"));
    assert(prescriptionSnapshots(f.db).length > old);
    captureUpcomingWorkouts(f.db, now);
    assert.equal(
      prescriptionSnapshots(f.db).filter((s) => s.day === "2026-11-28").length,
      2,
    );
    f.repo.saveCheckIn({
      day: "2026-11-27",
      pain: 0,
      fatigue: 3,
      soreness: 1,
      notes: "",
    });
    captureUpcomingWorkouts(f.db, new Date("2026-11-27T09:00:00Z"));
    const held = prescriptionSnapshots(f.db)
      .filter((s) => s.day === "2026-11-28")
      .at(-1)!;
    assert.deepEqual(mainMax(held.workout!), [140]);
    assert(prescriptionSnapshots(f.db).some((s) => s.id === base.id));
    f.repo.saveCheckIn({
      day: "2026-11-27",
      pain: 0,
      fatigue: 1,
      soreness: 1,
      notes: "",
    });
    captureUpcomingWorkouts(f.db, new Date("2026-11-27T10:00:00Z"));
    f.insert("sat", "2026-11-28", { averageHeartRate: 145 });
    const after = new Date("2026-11-28T14:00:00Z");
    const review = workoutReviews(f.db, after).reviews.find(
      (r) => r.activityId === "sat",
    )!;
    assert(review.versionKnown);
    assert.equal(review.match, "automatic");
    assert.deepEqual(mainMax(review.snapshot!.workout!), [148]);
    const recorded = f
      .calendar(after)
      .days[5].sessions.find((s) => s.session.sport === "running")!;
    assert.equal(recorded.status, "recorded");
    assert(recorded.session.sport === "running");
    assert.deepEqual(mainMax(recorded.session.workout), [148]);
    f.db
      .prepare(
        "INSERT INTO daily_health(id,day,sleep_seconds,resting_heart_rate,raw_json,imported_at) VALUES('sun','2026-11-29',28800,50,'{}',?)",
      )
      .run("2026-11-29T08:00:00Z");
    f.sync("2026-11-29T08:00:00Z");
    assert.equal(
      f.assess(new Date("2026-11-29T09:00:00Z")).automaticRecovery?.status,
      "base",
      "A tolerated automatic base run can maintain the decision after another supportive night",
    );
  } finally {
    f.db.close();
  }
});

test("automatic recovery metadata is derived, invalidates on recording changes and stays compact in the coach", () => {
  const f = fixture();
  try {
    const r = f.assess();
    f.events.saveRace(r);
    assert(!f.events.all().races[0].automaticRecovery);
    assert(automaticBaseReturn(r, "2026-11-28", "2026-11-27"));
    assert(
      !automaticBaseReturn(
        { ...r, expectedMinutes: 160 },
        "2026-11-28",
        "2026-11-27",
      ),
    );
    assert(
      !automaticBaseReturn(
        { ...r, recorded: { ...r.recorded!, minutes: 160 } },
        "2026-11-28",
        "2026-11-27",
      ),
    );
    assert.equal(r.automaticRecovery!.revision, raceRevision(r));
    const context = coachContext(f.db, now);
    const text = JSON.stringify(context.payload);
    assert(text.includes("automaticRecovery"));
    assert(!text.includes("PRIVATE TRAIL"));
    assert(Buffer.byteLength(text) < 23800);
    const weekly = JSON.stringify(
      weeklyModelContext(weeklyPlanning(f.db, now)),
    );
    assert(weekly.includes("automatic base only"));
    assert(Buffer.byteLength(weekly) < 18000);
    assert.equal(
      (
        f.db.prepare("SELECT count(*) n FROM coach_requests").get() as {
          n: number;
        }
      ).n,
      0,
    );
  } finally {
    f.db.close();
  }
});

test("pace comparison uses three similar pre-race road references, never cross-terrain or missing conditions", () => {
  const f = fixture();
  try {
    const rawJson = JSON.stringify({
      elevationGain: 30,
      startLatitude: 38.7,
      startLongitude: -9.1,
      minTemperature: 15,
      maxTemperature: 19,
    });
    for (const day of ["2026-11-10", "2026-11-12", "2026-11-14"]) {
      const run: RunWorkout = {
        ...f.plan.workouts[1],
        dayOffset: 0,
        title: "Base",
        type: "base",
      };
      recordPrescriptionCalendar(
        f.db,
        {
          start: day,
          days: [
            {
              day,
              dayOffset: 0,
              sessions: [
                {
                  status: "planned",
                  session: {
                    sport: "running",
                    slot: "lunch",
                    id: day + ":running",
                    workout: run,
                  },
                },
              ],
              recorded: [],
              warnings: [],
            },
          ],
        },
        375,
        new Date(day + "T08:00:00Z"),
        "approved",
        day,
      );
      f.insert(day, day, { durationSeconds: 2300, rawJson });
    }
    f.db
      .prepare("UPDATE activities SET raw_json=? WHERE id IN ('wed','thu')")
      .run(rawJson);
    assert.equal(f.assess().automaticRecovery?.paceComparison, "caution");
    assert.equal(f.assess().automaticRecovery?.status, "recovery");
    f.db
      .prepare(
        "UPDATE activities SET duration_seconds=2700 WHERE id LIKE '2026-%'",
      )
      .run();
    assert.equal(f.assess().automaticRecovery?.paceComparison, "no_concern");
    assert.equal(f.assess().automaticRecovery?.status, "base");
    const payload = JSON.stringify(coachContext(f.db, now).payload);
    assert(!payload.includes("startLatitude"));
    assert(!payload.includes("startLongitude"));
    f.db
      .prepare(
        "UPDATE activities SET sport_type='trail_running' WHERE id LIKE '2026-%'",
      )
      .run();
    assert.equal(f.assess().automaticRecovery?.paceComparison, "unavailable");
    f.db
      .prepare(
        "UPDATE activities SET sport_type='running',raw_json='{}' WHERE id LIKE '2026-%'",
      )
      .run();
    assert.equal(f.assess().automaticRecovery?.paceComparison, "unavailable");
  } finally {
    f.db.close();
  }
});

test("a run finishing after midnight needs a later night of recovery data", () => {
  const f = fixture();
  try {
    f.db
      .prepare(
        "UPDATE activities SET started_at='2026-11-26T23:50:00Z' WHERE id='thu'",
      )
      .run();
    assert.equal(f.assess().automaticRecovery?.lastRunDay, "2026-11-27");
    assert.equal(f.assess().automaticRecovery?.status, "recovery");
  } finally {
    f.db.close();
  }
});
