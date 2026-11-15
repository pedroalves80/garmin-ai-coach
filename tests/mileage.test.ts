import { POST as postMileage } from "../src/app/api/training/mileage/route";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/server/db/migrate";
import { GarminRepository } from "../src/server/db/garmin-repository";
import { CommitmentRepository } from "../src/server/training/commitment-repository";
import { saveRaceExtras } from "../src/server/training/mileage";
import { weeklyMetrics } from "../src/server/training/metrics";
import {
  countedActivityKm,
  raceExtraMeters,
  calendarMileage,
} from "../src/shared/mileage";
import { workoutKm, createTrainingPlan } from "../src/shared/training-plan";
import {
  raceWorkout,
  applyCommitments,
} from "../src/shared/commitment-calendar";
import { DEFAULT_TARGETS } from "../src/shared/types/athlete";
import {
  DEFAULT_WEEK_PREFERENCES,
  DEFAULT_PREFERENCES,
} from "../src/shared/types/schedule";
import { buildWeekSchedule } from "../src/shared/weekly-schedule";
import { measuredLoad } from "../src/server/training/load";
const now = new Date("2026-11-08T20:00:00Z");
function fixture() {
  const db = new Database(":memory:");
  migrateDatabase(db);
  const race = {
    id: randomUUID(),
    name: "Test event",
    day: "2026-11-08",
    startTime: null,
    terrain: "road" as const,
    distanceKm: 10,
    elevationGain: null,
    expectedMinutes: 50,
    priority: "training" as const,
    status: "completed" as const,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  new CommitmentRepository(db).saveRace(race);
  const add = (
    id: string,
    km: number,
    type = "running",
    name = "Recorded training",
  ) =>
    db
      .prepare(
        "INSERT INTO activities(id,provider_activity_id,sport_type,name,started_at,duration_seconds,distance_meters,average_heart_rate,raw_json,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        id,
        type,
        name,
        race.day + "T08:00:00Z",
        3600,
        km * 1000,
        145,
        "{}",
        now.toISOString(),
      );
  add("combined", 11.5);
  add("warm", 2.00672);
  add("class", 5, "hyrox");
  add("named-class", 3, "running", "HYROX class");
  add("cycle", 40, "cycling");
  return { db, race, add };
}
test("race extras are explicit and reversible, while Hyrox never counts and physical load is retained", () => {
  const { db, race } = fixture();
  try {
    const repo = new GarminRepository(db);
    const before = measuredLoad(repo.allActivities(), [], now);
    saveRaceExtras(
      db,
      {
        activityId: "combined",
        raceId: race.id,
        excludedKm: 1.5,
        confirmed: true,
      },
      now,
    );
    saveRaceExtras(
      db,
      {
        activityId: "warm",
        raceId: race.id,
        excludedKm: 2.00672,
        confirmed: true,
      },
      now,
    );
    const activities = repo.allActivities(),
      week = weeklyMetrics(activities, now).at(-1)!;
    assert(Math.abs(week.runningKm - 10) < 1e-8);
    assert(Math.abs(week.totalRunningKm! - 13.50672) < 1e-8);
    assert(Math.abs(week.raceExtraKm! - 3.50672) < 1e-8);
    assert.equal(week.hyroxMinutes, 120);
    assert.equal(week.runningMinutes, 120);
    assert.deepEqual(measuredLoad(activities, [], now), before);
    saveRaceExtras(
      db,
      { activityId: "warm", raceId: null, excludedKm: 0, confirmed: true },
      now,
    );
    assert.equal(
      countedActivityKm(repo.allActivities().find((a) => a.id === "warm")!),
      2.00672,
    );
  } finally {
    db.close();
  }
});
test("invalid exclusions cannot mutate classifications and sync distance corrections never produce negative mileage", () => {
  const { db, race, add } = fixture();
  try {
    for (const input of [
      { activityId: "class", raceId: race.id, excludedKm: 1, confirmed: true },
      {
        activityId: "named-class",
        raceId: race.id,
        excludedKm: 1,
        confirmed: true,
      },
      {
        activityId: "combined",
        raceId: race.id,
        excludedKm: 12,
        confirmed: true,
      },
      { activityId: "combined", raceId: null, excludedKm: 1, confirmed: true },
      {
        activityId: "combined",
        raceId: race.id,
        excludedKm: 1,
        confirmed: false,
      },
    ]) {
      const before = db.serialize();
      assert.throws(() => saveRaceExtras(db, input, now));
      assert.deepEqual(db.serialize(), before);
    }
    saveRaceExtras(
      db,
      {
        activityId: "combined",
        raceId: race.id,
        excludedKm: 1.5,
        confirmed: true,
      },
      now,
    );
    db.prepare(
      "UPDATE activities SET distance_meters=1000 WHERE id='combined'",
    ).run();
    const a = new GarminRepository(db)
      .allActivities()
      .find((a) => a.id === "combined")!;
    assert.equal(countedActivityKm(a), 0);
    assert.equal(raceExtraMeters(a), 1000);
    add("late", 1);
    db.prepare(
      "UPDATE activities SET started_at='2026-11-15T08:00:00Z' WHERE id='late'",
    ).run();
    assert.throws(
      () =>
        saveRaceExtras(
          db,
          {
            activityId: "late",
            raceId: race.id,
            excludedKm: 1,
            confirmed: true,
          },
          new Date("2026-11-15T20:00:00Z"),
        ),
      /Associate/,
    );
  } finally {
    db.close();
  }
});
test("the planned target counts race course only and every physical step remains in Garmin", () => {
  const { db, race } = fixture();
  try {
    const workout = raceWorkout(race, 6, DEFAULT_TARGETS);
    assert.equal(workoutKm(workout, 375), 11.5);
    const plan = createTrainingPlan(11, "2026-11-02", 375, 270, 40);
    const calendar = applyCommitments(
      buildWeekSchedule(plan, DEFAULT_WEEK_PREFERENCES, DEFAULT_PREFERENCES),
      plan,
      { races: [{ ...race, status: "planned" }], pauses: [] },
      DEFAULT_TARGETS,
      { today: "2026-11-01", returnReady: false },
    );
    const totals = calendarMileage(calendar, 375);
    assert.equal(totals.countedKm, 40);
    assert.equal(totals.totalKm, 41.5);
    assert.equal(totals.raceExtrasKm, 1.5);
  } finally {
    db.close();
  }
});

test("race-mileage mutation retains local host and origin protection", async () => {
  const response = await postMileage(
    new Request("http://localhost:3100/api/training/mileage", {
      method: "POST",
      headers: {
        host: "localhost:3100",
        origin: "https://example.com",
        "Content-Type": "application/json",
        "x-coach-request": "local",
      },
      body: "{}",
    }),
  );
  assert.equal(response.status, 403);
});
