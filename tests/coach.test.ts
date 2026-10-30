import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/server/db/migrate";
import { TrainingRepository } from "../src/server/training/repository";
import { createTrainingPlan, workoutKm } from "../src/shared/training-plan";
import { coachContext } from "../src/server/coach/context";
import { workoutProposal } from "../src/server/coach/policy";
import { CoachService } from "../src/server/coach/service";
import type { CoachAdapter } from "../src/server/coach/openai";
import { sameWorkout } from "../src/shared/workout-identity";

const now = new Date("2026-10-29T13:00:00Z");
const output = {
  summary: "Training summary.",
  observations: ["The current week is partial."],
  action: "shorten",
  reason: "Reduce running while recovering.",
};
function fixture() {
  const db = new Database(":memory:");
  migrateDatabase(db);
  const training = new TrainingRepository(db);
  training.savePlan(createTrainingPlan(1, "2026-10-26"));
  training.saveCheckIn({
    day: "2026-10-29",
    fatigue: 2,
    soreness: 2,
    pain: 0,
    notes: "PRIVATE NOTE",
  });
  db.prepare(
    "INSERT INTO sync_state(provider,last_completed_at,updated_at) VALUES('garmin',?,?)",
  ).run(now.toISOString(), now.toISOString());
  return { db, training };
}
const adapter: CoachAdapter = async () => ({
  output,
  inputTokens: 300,
  outputTokens: 100,
});

test("summaries omit names, GPS, notes and raw health JSON; missing data stays unknown", () => {
  const { db } = fixture();
  db.prepare(
    "INSERT INTO activities(id,provider_activity_id,sport_type,name,started_at,raw_json,imported_at) VALUES('a','a','cycling','PRIVATE NAME','2026-10-28T12:00:00Z',?,?)",
  ).run(
    JSON.stringify({ startLatitude: 42, secret: "PRIVATE RAW" }),
    now.toISOString(),
  );
  const context = coachContext(db, now),
    serialized = JSON.stringify(context.payload);
  for (const value of [
    "PRIVATE NOTE",
    "PRIVATE NAME",
    "PRIVATE RAW",
    "startLatitude",
    "rawJson",
  ])
    assert(!serialized.includes(value));
  assert.deepEqual(context.payload.health, []);
  assert.equal(context.payload.comparison.secondsPerKmChange, null);
  assert.equal(context.payload.weeks.at(-1)!.partial, true);
  db.close();
});

test("daily proposals never add distance or speed; weekly reviews cannot change workouts", () => {
  const { db } = fixture();
  const context = coachContext(db, now);
  for (const action of ["shorten", "easy"] as const) {
    const proposal = workoutProposal(context, "today", action)!;
    assert(proposal.after);
    assert(workoutKm(proposal.after, 375) <= workoutKm(proposal.before, 375));
    assert.deepEqual(proposal.after.steps[0], {
      kind: "step",
      name: "Run",
      amount: {
        kind: "distance",
        meters: Math.max(
          5000,
          Math.floor(
            (workoutKm(proposal.before, 375) *
              1000 *
              (action === "shorten" ? 0.8 : 1)) /
              10,
          ) * 10,
        ),
      },
      target: { kind: "hr", min: 125, max: 140 },
    });
  }
  assert.equal(workoutProposal(context, "today", "rest")!.after, null);
  assert.equal(workoutProposal(context, "weekly", "follow"), null);
  assert.throws(() => workoutProposal(context, "weekly", "easy"), /conflicts/);
  db.close();
});

test("recent pain forces rest; high fatigue permits only reduction or rest", () => {
  const { db, training } = fixture();
  training.saveCheckIn({
    day: "2026-10-29",
    fatigue: 4,
    soreness: 2,
    pain: 0,
    notes: "",
  });
  assert.deepEqual(coachContext(db, now).allowed, ["shorten", "rest"]);
  training.saveCheckIn({
    day: "2026-10-28",
    fatigue: 2,
    soreness: 2,
    pain: 1,
    notes: "",
  });
  const pain = coachContext(db, now);
  assert.deepEqual(pain.allowed, ["rest"]);
  assert.throws(() => workoutProposal(pain, "today", "easy"), /conflicts/);
  assert.equal(workoutProposal(pain, "today", "rest")!.after, null);
  db.close();
});

test("coach reductions respect 5 km and offer rest when the run cannot be shortened", () => {
  const { db, training } = fixture();
  training.savePlan(createTrainingPlan(1, "2026-10-26", 375, 270, 22.5));
  const reduced = workoutProposal(coachContext(db, now), "today", "shorten")!;
  assert.equal(workoutKm(reduced.after!, 375), 5);
  assert(workoutKm(reduced.after!, 375) < workoutKm(reduced.before, 375));
  training.savePlan(createTrainingPlan(1, "2026-10-26", 375, 270, 20));
  training.saveCheckIn({
    day: "2026-10-29",
    fatigue: 4,
    soreness: 2,
    pain: 0,
    notes: "",
  });
  const context = coachContext(db, now);
  assert.deepEqual(context.allowed, ["rest"]);
  assert.throws(
    () => workoutProposal(context, "today", "shorten"),
    /conflicts/,
  );
  assert.equal(workoutProposal(context, "today", "rest")!.after, null);
  db.close();
});

test("no saved run, completed running, missing check-in and stale sync block additions", () => {
  const { db } = fixture();
  db.prepare("DELETE FROM daily_check_ins").run();
  assert.equal(coachContext(db, now).canAdjust, false);
  db.prepare(
    "UPDATE sync_state SET last_completed_at='2026-10-20T12:00:00Z'",
  ).run();
  assert.equal(coachContext(db, now).canAdjust, false);
  db.prepare("DELETE FROM training_plans").run();
  assert.equal(coachContext(db, now).workout, null);
  assert.equal(workoutProposal(coachContext(db, now), "today", "follow"), null);
  db.close();
  const next = fixture();
  next.db
    .prepare(
      "INSERT INTO activities(id,provider_activity_id,sport_type,started_at,raw_json,imported_at) VALUES('a','a','running','2026-10-29T12:00:00Z','{}',?)",
    )
    .run(now.toISOString());
  assert.equal(coachContext(next.db, now).canAdjust, false);
  assert.deepEqual(coachContext(next.db, now).allowed, [
    "follow",
    "skip_secondary",
  ]);
  next.db.close();
});

test("identical reviews are cached across service instances; new check-ins invalidate them", async () => {
  const { db, training } = fixture();
  let calls = 0;
  const fake: CoachAdapter = async (input) => {
    calls++;
    const result = await adapter(input);
    return {
      ...result,
      output: {
        ...output,
        action: input.allowed.includes("shorten") ? "shorten" : "easy",
      },
    };
  };
  const service = new CoachService(db, fake, "test", () => now);
  const first = await service.review("today");
  assert.equal(first.cached, false);
  assert(first.review.proposal);
  assert.equal(training.overrides().length, 0);
  const second = await new CoachService(db, fake, "test", () => now).review(
    "today",
  );
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  training.saveCheckIn({
    day: "2026-10-29",
    fatigue: 3,
    soreness: 2,
    pain: 0,
    notes: "",
  });
  assert.equal((await service.review("today")).cached, false);
  assert.equal(calls, 2);
  assert.equal(service.status(true).dailyUsed, 2);
  db.close();
});

test("only explicit fresh approval saves the deterministic workout; approval is idempotent", async () => {
  const { db, training } = fixture();
  const service = new CoachService(db, adapter, "test", () => now);
  const { review } = await service.review("today");
  assert.equal(training.overrides().length, 0);
  assert.deepEqual(service.accept(review.id), { saved: true });
  assert.deepEqual(training.overrides()[0].workout, review.proposal!.after);
  assert.deepEqual(service.accept(review.id), { saved: true });
  assert.equal(training.overrides().length, 1);
  const original = createTrainingPlan(1, "2026-10-26").workouts.find(
    (w) => w.dayOffset === 3,
  )!;
  assert(sameWorkout(training.overrides()[0].before, original));
  assert(!sameWorkout(training.overrides()[0].workout!, original));
  assert(
    !sameWorkout(
      training.overrides()[0].before,
      createTrainingPlan(1, "2026-10-26", 375, 280).workouts.find(
        (w) => w.dayOffset === 3,
      )!,
    ),
  );
  training.savePlan(createTrainingPlan(1, "2026-10-26"));
  assert.equal(training.overrides().length, 0);
  db.close();
});

test("changed check-in, changed plan and next-day proposals cannot be approved", async () => {
  for (const change of ["check-in", "plan", "date"]) {
    const { db, training } = fixture();
    let time = now;
    const service = new CoachService(db, adapter, "test", () => time);
    const { review } = await service.review("today");
    if (change === "check-in")
      training.saveCheckIn({
        day: "2026-10-29",
        fatigue: 3,
        soreness: 3,
        pain: 1,
        notes: "",
      });
    if (change === "plan")
      training.savePlan(createTrainingPlan(1, "2026-10-26", 400));
    if (change === "date") time = new Date("2026-10-30T13:00:00Z");
    assert.throws(() => service.accept(review.id), /changed/);
    assert.equal(training.overrides().length, 0);
    db.close();
  }
});

test("the coach sees approved steps and new pain can supersede an approved run with rest", async () => {
  const { db, training } = fixture();
  const service = new CoachService(db, adapter, "test", () => now);
  const { review } = await service.review("today");
  service.accept(review.id);
  assert.deepEqual(
    coachContext(db, now).payload.todayWorkout?.steps,
    review.proposal!.after!.steps,
  );
  assert.throws(
    () => workoutProposal(coachContext(db, now), "today", "easy"),
    /conflicts/,
  );
  training.saveCheckIn({
    day: "2026-10-29",
    fatigue: 2,
    soreness: 2,
    pain: 2,
    notes: "",
  });
  const rest = new CoachService(
    db,
    async () => ({
      output: { ...output, action: "rest" },
      inputTokens: 1,
      outputTokens: 1,
    }),
    "test",
    () => now,
  );
  const next = await rest.review("today");
  assert(next.review.proposal);
  rest.accept(next.review.id);
  assert.equal(training.overrides()[0].workout, null);
  assert.equal(coachContext(db, now).payload.todayWorkout, null);
  assert.throws(() => service.accept(review.id), /changed/);
  db.close();
});

test("invalid, failed and disallowed model responses never save reviews or edits and consume request attempts", async () => {
  const { db, training } = fixture();
  for (const fake of [
    async () => ({
      output: { ...output, action: "increase" },
      inputTokens: 1,
      outputTokens: 1,
    }),
    async () => {
      throw new Error("secret provider error");
    },
    async () => ({ output, inputTokens: 1, outputTokens: 1 }),
  ]) {
    const service = new CoachService(db, fake, "test", () => now);
    await assert.rejects(
      service.review("weekly"),
      (error) =>
        error instanceof Error &&
        !error.message.includes("secret provider error"),
    );
  }
  assert.equal(training.overrides().length, 0);
  assert.equal(
    new CoachService(db, adapter, "test", () => now).status(true).dailyUsed,
    3,
  );
  assert.equal(db.prepare("SELECT id FROM coach_reviews").all().length, 0);
  db.close();
});

test("persistent limits and concurrent request lock prevent duplicate AI spend", async () => {
  const { db } = fixture();
  let resolve!: () => void;
  const blocked = new Promise<void>((r) => {
    resolve = r;
  });
  const service = new CoachService(
    db,
    async (input) => {
      await blocked;
      return adapter(input);
    },
    "test",
    () => now,
  );
  const pending = service.review("today");
  await assert.rejects(
    new CoachService(db, adapter, "test", () => now).review("today"),
    /already running/,
  );
  resolve();
  await pending;
  assert.equal(service.status(true).dailyUsed, 1);
  for (let i = 1; i < 6; i++)
    db.prepare(
      "INSERT INTO coach_requests(id,day,created_at,finished) VALUES(?,?,?,1)",
    ).run(`limit${i}`, "2026-10-29", now.toISOString());
  await assert.rejects(service.review("weekly"), /limit reached/);
  assert.equal((await service.review("today")).cached, true);
  for (let i = 6; i < 60; i++)
    db.prepare(
      "INSERT INTO coach_requests(id,day,created_at,finished) VALUES(?,?,?,1)",
    ).run(`limit${i}`, "2026-10-28", now.toISOString());
  const tomorrow = new CoachService(
    db,
    adapter,
    "test",
    () => new Date("2026-10-30T13:00:00Z"),
  );
  await assert.rejects(tomorrow.review("weekly"), /limit reached/);
  db.close();
});

test("approved review fingerprints stay current until new recovery data arrives", async () => {
  const { db, training } = fixture();
  const service = new CoachService(db, adapter, "test", () => now);
  const { review } = await service.review("today");
  assert.equal(service.status(true).contextHash, review.contextHash);
  service.accept(review.id);
  const status = service.status(true);
  assert.equal(
    status.reviews.find((r) => r.id === review.id)?.appliedContextHash,
    status.contextHash,
  );
  training.saveCheckIn({
    day: "2026-10-29",
    fatigue: 3,
    soreness: 2,
    pain: 0,
    notes: "",
  });
  const changed = service.status(true);
  assert.notEqual(
    changed.reviews.find((r) => r.id === review.id)?.appliedContextHash,
    changed.contextHash,
  );
  db.close();
});
