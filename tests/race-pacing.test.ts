import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { racePacing, racePacingContext } from "../src/shared/race-pacing";
import { RacePacingRepository } from "../src/server/training/race-pacing-repository";
import { migrateDatabase } from "../src/server/db/migrate";
import { applyCommitments } from "../src/shared/commitment-calendar";
import { createTrainingPlan } from "../src/shared/training-plan";
import { buildWeekSchedule } from "../src/shared/weekly-schedule";
import { DEFAULT_TARGETS } from "../src/shared/types/athlete";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_WEEK_PREFERENCES,
} from "../src/shared/types/schedule";
import type { RaceEvent } from "../src/shared/types/commitments";
import type { RacePaceEvidence } from "../src/shared/types/race-pacing";
import { weeklyPlanning } from "../src/server/training/weekly-planning";
import { coachContext } from "../src/server/coach/context";
import { CommitmentRepository } from "../src/server/training/commitment-repository";
import { randomUUID } from "node:crypto";
const now = new Date("2026-11-10T12:00:00Z"),
  today = "2026-11-10";
const context = { runningKm: 26, longestKm: 10, matchedPairs: 0 };
const evidence: RacePaceEvidence = {
  id: "PRIVATE REFERENCE ID",
  day: today,
  source: "garmin_prediction",
  distanceKm: 10,
  seconds: 3000,
  updatedAt: now.toISOString(),
};
function race(extra: Partial<RaceEvent> = {}): RaceEvent {
  return {
    id: randomUUID(),
    name: "PRIVATE EVENT NAME",
    day: "2026-12-20",
    startTime: null,
    distanceKm: 10,
    terrain: "road",
    elevationGain: null,
    expectedMinutes: 45,
    priority: "goal",
    status: "planned",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...extra,
  };
}
function db(t: TestContext) {
  const d = new Database(":memory:");
  migrateDatabase(d);
  t.after(() => d.close());
  return d;
}
test("Garmin 50:00 is an estimate with a labelled conservative range, not proof of a 45-minute goal", () => {
  const r = race(),
    p = racePacing(r, [evidence], today, [r], context);
  assert.equal(p.confidence, "low");
  assert.equal(p.predictedSeconds, 3000);
  assert.equal(Math.round(p.predictedPace!), 300);
  assert.deepEqual(p.range, { min: 315, max: 330 });
  assert(
    p.notes.some((n) => n.includes("not a validated confidence interval")),
  );
  assert.equal(r.expectedMinutes, 45);
  assert.equal(
    racePacing({ ...r, expectedMinutes: 30 }, [evidence], today, [r], context)
      .predictedSeconds,
    3000,
  );
});
test("no estimate is manufactured from event goals, ordinary training or stale/future evidence", () => {
  const r = race();
  for (const rows of [
    [],
    [{ ...evidence, day: "2026-10-01" }],
    [{ ...evidence, day: "2026-11-11" }],
  ])
    assert.equal(racePacing(r, rows, today, [r], context).range, null);
  assert.equal(
    racePacing({ ...r, distanceKm: 5 }, [evidence], today, [r], context).range,
    null,
  );
});
test("confirmed road results allow bounded cross-distance estimates; trails and long extrapolations do not", () => {
  const r = race(),
    actual = {
      ...evidence,
      source: "road_race" as const,
      distanceKm: 5,
      seconds: 1500,
    };
  const p = racePacing(r, [actual], today, [r], context);
  assert.equal(p.confidence, "moderate");
  assert.equal(p.predictedSeconds, Math.round(1500 * Math.pow(2, 1.07)));
  assert.equal(
    racePacing({ ...r, distanceKm: 42.2 }, [actual], today, [r], context).range,
    null,
  );
  assert.equal(
    racePacing({ ...r, terrain: "trail" }, [actual], today, [r], context)
      .predictedPace,
    null,
  );
});
test("December 23 remains registered in its week while the December 20 recovery conflict prevents prescription and pace", () => {
  const first = race(),
    second = race({ day: "2026-12-23", priority: "training" }),
    plan = createTrainingPlan(3, "2026-12-21", 375, 270, 26.3);
  const base = buildWeekSchedule(
    plan,
    DEFAULT_WEEK_PREFERENCES,
    DEFAULT_PREFERENCES,
  );
  const c = applyCommitments(
    base,
    plan,
    { races: [first, second], pauses: [] },
    DEFAULT_TARGETS,
    { today, returnReady: true },
  );
  assert.equal(c.days[2].race?.id, second.id);
  assert.equal(c.days[2].sessions.length, 0);
  assert.equal(c.days[2].rule?.phase, "race_recovery");
  assert(
    c.days[2].rule?.notes.some(
      (n) => n.includes("3 days after") && n.includes("2026-12-20"),
    ),
  );
  const p = racePacing(second, [evidence], today, [first, second], context);
  assert.equal(p.status, "conflict");
  assert.equal(p.range, null);
  assert.equal(p.predictedSeconds, 3000);
  const outside = racePacing(
    { ...second, day: "2026-12-24", priority: "goal" },
    [evidence],
    today,
    [first],
    context,
  );
  assert(outside.range);
});
test("training events retain controlled effort instead of turning their estimate into an all-out pace", () => {
  const r = race({ priority: "training" });
  const p = racePacing(r, [evidence], today, [r], context);
  assert.equal(p.status, "training");
  assert.equal(p.range, null);
  assert.equal(p.predictedSeconds, 3000);
});
test("pace evidence requires explicit confirmation and valid past road data; updates retain one reference per day/source/distance", (t) => {
  const d = db(t),
    repo = new RacePacingRepository(d),
    input = {
      day: today,
      source: "garmin_prediction",
      distanceKm: 10,
      seconds: 3000,
      confirmed: true,
    };
  repo.save(input, now);
  repo.save({ ...input, seconds: 2700 }, now);
  assert.equal(repo.all().length, 1);
  assert.equal(repo.all()[0].seconds, 2700);
  for (const bad of [
    { ...input, confirmed: false },
    { ...input, day: "2026-12-20" },
    { ...input, day: "2026-01-01" },
    { ...input, seconds: 100 },
    { ...input, distanceKm: 42.2 },
  ])
    assert.throws(() => repo.save(bad, now));
  assert.equal(repo.all().length, 1);
});
test("existing AI summaries receive only sanitized road advice; saving evidence invalidates stale analysis without editing race goals", (t) => {
  const d = db(t),
    r = race();
  new CommitmentRepository(d).saveRace(r);
  const before = weeklyPlanning(d, now).evidenceHash;
  new RacePacingRepository(d).save(
    {
      day: today,
      source: "garmin_prediction",
      distanceKm: 10,
      seconds: 3000,
      confirmed: true,
    },
    now,
  );
  const after = weeklyPlanning(d, now);
  assert.notEqual(after.evidenceHash, before);
  const text = JSON.stringify(racePacingContext(after.racePaceAdvice));
  assert(!text.includes("PRIVATE"));
  assert(!text.includes(r.id));
  assert(text.includes("garmin_prediction"));
  assert(
    coachContext(d, now).payload.roadRacePacing.some(
      (p) => p.predictedPace !== null,
    ),
  );
  assert.equal(new CommitmentRepository(d).all().races[0].expectedMinutes, 45);
});
