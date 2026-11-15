import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { migrateDatabase } from "../src/server/db/migrate";
import { CommitmentRepository } from "../src/server/training/commitment-repository";
import { updateCommitment } from "../src/server/training/commitments";
import { observeRaces } from "../src/server/training/race-observations";
import {
  activeRaceSchedule,
  raceRevision,
  raceWindow,
  reviewedBaseReturn,
} from "../src/shared/race-policy";
import { applyCommitments } from "../src/shared/commitment-calendar";
import { createTrainingPlan } from "../src/shared/training-plan";
import { buildWeekSchedule } from "../src/shared/weekly-schedule";
import { fitMileageWeek } from "../src/shared/fit-mileage-week";
import { calendarMileage } from "../src/shared/mileage";
import { weeklyMileageExplanation } from "../src/shared/weekly-mileage-explanation";
import { DEFAULT_TARGETS } from "../src/shared/types/athlete";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_WEEK_PREFERENCES,
} from "../src/shared/types/schedule";
import { plannedEffort } from "../src/shared/planned-load";
import { racePacing } from "../src/shared/race-pacing";
import type { RaceEvent } from "../src/shared/types/commitments";
import type { ActivityMeasurement } from "../src/shared/types/metrics";
const stamp = "2026-11-15T10:00:00Z";
function race(extra: Partial<RaceEvent> = {}): RaceEvent {
  return {
    id: randomUUID(),
    name: "Private event",
    day: "2026-12-20",
    startTime: null,
    distanceKm: 10,
    terrain: "road",
    elevationGain: null,
    expectedMinutes: 45,
    priority: "goal",
    status: "planned",
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  };
}
function calendar(
  races: RaceEvent[],
  start = "2026-12-21",
  stage = 8,
  km = 27,
  today = "2026-11-15",
) {
  const plan = createTrainingPlan(stage, start, 375, 270, km),
    commitments = { races, pauses: [] };
  const base = buildWeekSchedule(
    plan,
    DEFAULT_WEEK_PREFERENCES,
    DEFAULT_PREFERENCES,
  );
  const adapted = applyCommitments(base, plan, commitments, DEFAULT_TARGETS, {
    today,
    returnReady: false,
  });
  return {
    plan,
    adapted,
    fitted: fitMileageWeek(adapted, plan, commitments, {
      today,
      longestRecentKm: 9,
    }).calendar,
  };
}
function fixture(date: string) {
  const db = new Database(":memory:");
  migrateDatabase(db);
  const now = new Date(date);
  db.prepare(
    "INSERT INTO sync_state(provider,last_completed_at,updated_at) VALUES('garmin',?,?)",
  ).run(date, date);
  return { db, now, repo: new CommitmentRepository(db) };
}
function recording(r: RaceEvent, minutes = 50): ActivityMeasurement {
  return {
    id: randomUUID(),
    name: "Private recording",
    sportType: "running",
    startedAt: r.day + "T09:00:00Z",
    distanceMeters: r.distanceKm * 1000,
    durationSeconds: minutes * 60,
    averageHeartRate: 145,
    rawJson: "{}",
  };
}
function persist(db: Database.Database, a: ActivityMeasurement) {
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
    stamp,
  );
}

test("December's withheld second race adds no phantom rest, recovery, taper or mileage and the 27 km milestone fits", () => {
  const first = race(),
    second = race({ day: "2026-12-23", priority: "training" });
  const { plan, adapted, fitted } = calendar([second, first]);
  assert.equal(adapted.days[2].race?.id, second.id);
  assert.equal(adapted.days[2].sessions.length, 0);
  assert.equal(adapted.days[3].rule, undefined);
  assert(adapted.days[3].sessions.some((s) => s.session.sport === "running"));
  assert.equal(adapted.days[5].rule, undefined);
  assert.equal(calendarMileage(fitted, 375).countedKm, 27);
  assert.equal(fitted.days[0].sessions.length, 0);
  assert.equal(fitted.days[2].sessions.length, 0);
  assert.equal(fitted.days[6].sessions.length, 0);
  const explanation = weeklyMileageExplanation(plan, fitted);
  assert.equal(explanation.milestoneKm, 27);
  assert.equal(explanation.shortfallKm, 0);
  assert.equal(explanation.unresolved[0].day, second.day);
  // A third event must not inherit a fictitious recovery window from the withheld second event.
  const third = race({ day: "2026-12-25", priority: "training" });
  assert.deepEqual(
    activeRaceSchedule([third, second, first]).active.map((r) => r.id),
    [first.id, third.id],
  );
});

test("reviewing controlled participation includes the course, recovery HR and physical load without an all-out pace", () => {
  const f = fixture(stamp);
  try {
    const first = race(),
      second = race({ day: "2026-12-23", priority: "training" });
    f.repo.saveRace(first);
    f.repo.saveRace(second);
    updateCommitment(
      f.db,
      {
        action: "review_race_participation",
        id: second.id,
        previousId: first.id,
        revision: raceRevision(second),
        previousRevision: raceRevision(first),
        confirmed: true,
      },
      f.now,
    );
    const events = f.repo.all().races,
      { fitted } = calendar(events);
    const event = fitted.days[2].sessions.find(
      (s) => s.session.sport === "running",
    )!.session;
    assert(event.sport === "running");
    assert.equal(event.workout.race?.id, second.id);
    assert.equal(calendarMileage(fitted, 375).countedKm, 27);
    assert.equal(calendarMileage(fitted, 375).raceExtrasKm, 1.5);
    const step = event.workout.steps[1];
    assert(step.kind === "step");
    assert.deepEqual(step.target, { kind: "hr", min: 125, max: 140 });
    assert.equal(plannedEffort(event), 3);
    const advice = racePacing(
      events.find((r) => r.id === second.id)!,
      [],
      "2026-11-15",
      events,
      { longestKm: 9, runningKm: 27, matchedPairs: 0 },
    );
    assert.equal(advice.status, "training");
    assert.equal(advice.range, null);
    assert(advice.notes.some((n) => n.includes("recovery HR")));
    const previousChanged = { ...first, distanceKm: 11 };
    assert(
      !activeRaceSchedule([
        previousChanged,
        events.find((r) => r.id === second.id)!,
      ]).active.some((r) => r.id === second.id),
    );
    assert.throws(
      () =>
        updateCommitment(
          f.db,
          {
            action: "review_race_participation",
            id: second.id,
            previousId: first.id,
            revision: "stale",
            previousRevision: raceRevision(first),
            confirmed: true,
          },
          f.now,
        ),
      /changed/,
    );
  } finally {
    f.db.close();
  }
});

test("initial rest, demanding-event recovery and explicit confirmation cannot be bypassed by participation review", () => {
  for (const extra of [
    { day: "2026-12-21" },
    { day: "2026-12-23", expectedMinutes: 150 },
  ]) {
    const f = fixture(stamp);
    try {
      const first = race(),
        second = race({ priority: "training", ...extra });
      f.repo.saveRace(first);
      f.repo.saveRace(second);
      const body = {
        action: "review_race_participation",
        id: second.id,
        previousId: first.id,
        revision: raceRevision(second),
        previousRevision: raceRevision(first),
        confirmed: true,
      };
      assert.throws(() => updateCommitment(f.db, body, f.now));
      assert.throws(() =>
        updateCommitment(f.db, { ...body, confirmed: false }, f.now),
      );
      assert(
        !f.repo.all().races.find((r) => r.id === second.id)!
          .participationReview,
      );
    } finally {
      f.db.close();
    }
  }
});

test("matching Garmin duration reassesses the forecast without treating absent reports as recovery clearance", () => {
  const event = race({
    day: "2026-11-22",
    expectedMinutes: 150,
    priority: "training",
  });
  const a = recording(event, 50),
    now = new Date("2026-11-24T12:00:00Z");
  assert.equal(raceWindow(event).recovery, 7);
  const observed = observeRaces({ races: [event], pauses: [] }, [a], now)
    .races[0];
  assert.equal(raceWindow(observed).recovery, 3);
  assert.equal(observed.recorded?.minutes, 50);
  assert.equal(observed.recoveryReview, undefined);
  const future = observeRaces(
    { races: [event], pauses: [] },
    [a],
    new Date("2026-11-21T12:00:00Z"),
  ).races[0];
  assert.equal(future.recorded, undefined);
  assert.equal(
    observeRaces(
      { races: [event], pauses: [] },
      [{ ...a, name: "Hyrox", sportType: "hyrox" }],
      now,
    ).races[0].recorded,
    undefined,
  );
  assert.equal(
    raceWindow({ ...observed, terrain: "trail", elevationGain: 900 }).recovery,
    7,
    "Entered trail ascent remains relevant even when the recording is faster",
  );
  const { fitted } = calendar([observed], "2026-11-23", 4, 23, "2026-11-24");
  assert(fitted.days[1].rule?.provisional === false);
  assert(fitted.days[2].rule?.provisional);
  assert(!fitted.days[3].rule);
});

test("one-time return-to-base review needs a recording and confirmation, but no daily check-in; quality remains reduced", () => {
  const f = fixture("2026-11-25T12:00:00Z");
  try {
    const event = race({
      day: "2026-11-22",
      priority: "training",
      terrain: "trail",
      distanceKm: 18,
      elevationGain: 900,
      expectedMinutes: 150,
    });
    f.repo.saveRace(event);
    const a = recording(event, 140);
    persist(f.db, a);
    const body = {
      action: "review_race_recovery",
      id: event.id,
      revision: raceRevision(event),
      activityId: a.id,
      confirmed: true,
    };
    assert.throws(() =>
      updateCommitment(f.db, { ...body, activityId: "missing" }, f.now),
    );
    assert.throws(() =>
      updateCommitment(f.db, { ...body, confirmed: false }, f.now),
    );
    updateCommitment(f.db, body, f.now);
    assert.equal(
      (
        f.db.prepare("SELECT count(*) n FROM daily_check_ins").get() as {
          n: number;
        }
      ).n,
      0,
    );
    const observed = observeRaces(f.repo.all(), [a], f.now).races[0];
    assert(reviewedBaseReturn(observed, "2026-11-25"));
    assert(
      !reviewedBaseReturn(
        { ...observed, recorded: { ...observed.recorded!, minutes: 150 } },
        "2026-11-25",
      ),
    );
    const { adapted } = calendar([observed], "2026-11-23", 4, 23, "2026-11-25");
    const run = adapted.days[3].sessions.find(
      (s) => s.session.sport === "running",
    )!.session;
    assert(run.sport === "running");
    assert.equal(run.workout.type, "base");
    assert(
      run.workout.steps.some(
        (s) =>
          s.kind === "step" && s.target.kind === "hr" && s.target.max === 148,
      ),
    );
    assert(
      !adapted.days[3].sessions.some((s) => s.session.sport !== "running"),
    );
  } finally {
    f.db.close();
  }
});

test("pain, initial rest, major events and stale sync still block an early return-to-base review", () => {
  for (const kind of ["pain", "rest", "major", "stale"]) {
    const date =
        kind === "rest" ? "2026-11-23T12:00:00Z" : "2026-11-25T12:00:00Z",
      f = fixture(date);
    try {
      const event = race({
        day: "2026-11-22",
        priority: "training",
        terrain: "trail",
        distanceKm: 18,
        elevationGain: 900,
        expectedMinutes: 150,
      });
      f.repo.saveRace(event);
      const a = recording(event, kind === "major" ? 250 : 140);
      persist(f.db, a);
      if (kind === "pain")
        f.db
          .prepare(
            "INSERT INTO daily_check_ins(day,fatigue,soreness,pain,notes,updated_at) VALUES(?,1,1,2,'',?)",
          )
          .run("2026-11-25", date);
      if (kind === "stale")
        f.db
          .prepare(
            "UPDATE sync_state SET last_completed_at='2026-11-20T12:00:00Z'",
          )
          .run();
      assert.throws(() =>
        updateCommitment(
          f.db,
          {
            action: "review_race_recovery",
            id: event.id,
            revision: raceRevision(event),
            activityId: a.id,
            confirmed: true,
          },
          f.now,
        ),
      );
      assert(!f.repo.all().races[0].recoveryReview);
    } finally {
      f.db.close();
    }
  }
});

test("new recovery concerns withhold a previously reviewed controlled event without creating phantom recovery", () => {
  const first = race(),
    second = race({ day: "2026-12-23", priority: "training" });
  second.participationReview = {
    previousId: first.id,
    previousRevision: raceRevision(first),
    revision: raceRevision(second),
    reviewedAt: stamp,
  };
  const plan = createTrainingPlan(8, "2026-12-21", 375, 270, 27);
  const result = applyCommitments(
    buildWeekSchedule(plan, DEFAULT_WEEK_PREFERENCES, DEFAULT_PREFERENCES),
    plan,
    { races: [first, second], pauses: [] },
    DEFAULT_TARGETS,
    {
      today: "2026-12-23",
      returnReady: false,
      raceRecovery: { stopRunning: true, reasons: ["Recent pain"] },
    },
  );
  assert.equal(result.days[2].sessions.length, 0);
  assert(result.days[2].rule?.notes.includes("Recent pain"));
  assert.equal(result.days[3].rule, undefined);
});

test("a race actually recorded despite an unresolved overlap does generate physical recovery", () => {
  const first = race(),
    second = race({ day: "2026-12-23", priority: "training" });
  second.recorded = { activityId: "recorded-event", km: 10, minutes: 50 };
  const result = calendar([first, second], "2026-12-21", 8, 27, "2026-12-24");
  assert.equal(result.adapted.days[3].rule?.phase, "race_recovery");
  assert.equal(result.adapted.days[3].sessions.length, 0);
});
