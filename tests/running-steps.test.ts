import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  withRunBookends,
  withCalendarBookends,
} from "../src/shared/running-steps";
import { applyCommitments } from "../src/shared/commitment-calendar";
import { fitMileageWeek } from "../src/shared/fit-mileage-week";
import {
  createTrainingPlan,
  workoutKm,
  garminWorkoutText,
} from "../src/shared/training-plan";
import { buildWeekSchedule } from "../src/shared/weekly-schedule";
import { DEFAULT_TARGETS } from "../src/shared/types/athlete";
import {
  DEFAULT_WEEK_PREFERENCES,
  DEFAULT_PREFERENCES,
} from "../src/shared/types/schedule";
import { calendarMileage } from "../src/shared/mileage";
import { plannedMinutes, plannedEffort } from "../src/shared/planned-load";
import { migrateDatabase } from "../src/server/db/migrate";
import { TrainingRepository } from "../src/server/training/repository";
import { ScheduleEditingService } from "../src/server/training/rescheduling";
import { trainingCalendar } from "../src/server/training/calendar";
import type { RunWorkout, PlanTarget } from "../src/shared/types/metrics";
import type { RaceEvent } from "../src/shared/types/commitments";
function single(
  target: PlanTarget = { kind: "hr", min: 135, max: 148 },
): RunWorkout {
  return {
    dayOffset: 1,
    title: "Saved base",
    type: "base",
    steps: [
      {
        kind: "step",
        name: "Run",
        amount: { kind: "distance", meters: 6000 },
        target,
      },
    ],
  };
}
function bookended(w: RunWorkout) {
  assert.equal(w.steps[0].kind, "step");
  assert(w.steps[0].kind === "step");
  assert.equal(w.steps[0].name, "Warm Up");
  const last = w.steps.at(-1)!;
  assert(last.kind === "step");
  assert.equal(last.name, "Cool Down");
}
function event(extra: Partial<RaceEvent> = {}): RaceEvent {
  return {
    id: randomUUID(),
    name: "Synthetic race",
    day: "2026-11-22",
    startTime: null,
    distanceKm: 10,
    terrain: "road",
    elevationGain: 0,
    expectedMinutes: 50,
    priority: "training",
    status: "planned",
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
    ...extra,
  };
}

test("legacy six-kilometre runs gain bookends without changing distance, main target, load, metadata or Garmin copy", () => {
  const plan = createTrainingPlan(3, "2026-11-16");
  for (const target of [
    { kind: "hr", min: 135, max: 148 },
    { kind: "hr", min: 110, max: 120 },
    { kind: "effort", min: 3, max: 4 },
    { kind: "effort", min: 2, max: 3 },
    { kind: "pace", min: 360, max: 400 },
  ] as PlanTarget[]) {
    const before = {
      ...single(target),
      ...(target.kind === "effort"
        ? { trail: { expectedMinutes: 60, ascentM: 300 } }
        : {}),
    };
    const snapshot = JSON.stringify(before),
      after = withRunBookends(before, DEFAULT_TARGETS);
    bookended(after);
    assert.deepEqual(
      after.steps.map((s) =>
        s.kind === "step" && s.amount.kind === "distance" ? s.amount.meters : 0,
      ),
      [500, 5000, 500],
    );
    assert.equal(workoutKm(after, 375), 6);
    assert(after.steps[1].kind === "step");
    assert.deepEqual(after.steps[1].target, target);
    assert.deepEqual(after.trail, before.trail);
    assert.equal(JSON.stringify(before), snapshot);
    assert.deepEqual(withRunBookends(after, DEFAULT_TARGETS), after);
    const beforeSession = {
        sport: "running" as const,
        slot: "lunch" as const,
        workout: before,
      },
      afterSession = { ...beforeSession, workout: after };
    assert.equal(
      plannedMinutes(afterSession, plan),
      plannedMinutes(beforeSession, plan),
    );
    assert.equal(plannedEffort(afterSession), plannedEffort(beforeSession));
    const text = garminWorkoutText(after);
    assert(text.includes("Warm Up — 0.50 km"));
    assert(text.includes("Run — 5.00 km"));
    assert(text.includes("Cool Down — 0.50 km"));
    for (const s of after.steps)
      if (s.kind === "step" && s.target.kind === "hr" && target.kind === "hr")
        assert(s.target.max <= target.max);
  }
});

test("all 30 stages retain warm-up/cool-down through event preparation, recovery, goal tapers and redistribution", () => {
  for (let stage = 1; stage <= 30; stage++)
    for (const r of [
      event({ day: "2026-11-29" }),
      event({
        day: "2026-11-22",
        terrain: "trail",
        distanceKm: 18,
        expectedMinutes: 150,
        elevationGain: 900,
      }),
      event({ day: "2026-11-28", priority: "goal" }),
    ]) {
      const plan = createTrainingPlan(stage, "2026-11-23"),
        commitments = { races: [r], pauses: [] },
        options = {
          today: "2026-11-16",
          returnReady: false,
          longestRecentKm: 30,
        };
      const calendar = applyCommitments(
        buildWeekSchedule(plan, DEFAULT_WEEK_PREFERENCES, DEFAULT_PREFERENCES),
        plan,
        commitments,
        DEFAULT_TARGETS,
        options,
      );
      const fitted = fitMileageWeek(
        calendar,
        plan,
        commitments,
        options,
      ).calendar;
      for (const day of fitted.days)
        for (const entry of day.sessions)
          if (entry.session.sport === "running") {
            const w = entry.session.workout;
            bookended(w);
            assert(workoutKm(w, 375) > 0);
            if (w.race) {
              assert.equal(w.race.distanceKm, r.distanceKm);
              assert(
                w.steps[1].kind === "step" &&
                  w.steps[1].amount.kind === "distance",
              );
              assert.equal(w.steps[1].amount.meters, r.distanceKm * 1000);
            } else assert(workoutKm(w, 375) >= 5);
          }
      assert(
        calendarMileage(fitted, 375).countedKm <= plan.targetKm + 0.001 ||
          r.distanceKm > plan.targetKm,
      );
    }
  const plan = createTrainingPlan(3, "2026-11-16"),
    before = structuredClone(plan);
  for (const w of plan.workouts)
    assert.equal(withRunBookends(w, DEFAULT_TARGETS), w);
  assert.deepEqual(
    plan,
    before,
    "Existing detailed tempo/stride structures are retained exactly",
  );
});

test("existing single-step plans remain editable, movable and undoable without rewriting history or duplicating bookends", () => {
  const db = new Database(":memory:");
  migrateDatabase(db);
  try {
    const now = new Date("2026-11-16T12:00:00Z"),
      repo = new TrainingRepository(db),
      plan = createTrainingPlan(3, "2026-11-16", 375, 270, 29);
    plan.workouts = plan.workouts.map((w, i) => ({
      ...single(),
      dayOffset: w.dayOffset,
      steps: [
        {
          kind: "step",
          name: "Run",
          amount: { kind: "distance", meters: [6000, 6000, 7000, 10000][i] },
          target: { kind: "hr", min: 135, max: 148 },
        },
      ],
    }));
    repo.savePlan(plan, now);
    db.prepare(
      "INSERT INTO sync_state(provider,last_completed_at,updated_at) VALUES('garmin',?,?)",
    ).run(now.toISOString(), now.toISOString());
    const original = db.prepare("SELECT plan_json FROM training_plans").get();
    const service = new ScheduleEditingService(db, now),
      source = service
        .catalog(plan.start)
        .days.find((d) => d.day === "2026-11-17")!
        .sessions.find((s) => s.session.sport === "running")!.session;
    assert(source.sport === "running");
    bookended(source.workout);
    const request = {
      action: "move" as const,
      day: "2026-11-17",
      sessionId: source.id!,
      toDay: "2026-11-18",
      toSlot: "morning" as const,
      reason: "unavailable" as const,
    };
    const preview = service.preview(request);
    const saved = service.apply(request, preview.revision);
    const moved = service
      .catalog(plan.start)
      .days.find((d) => d.day === "2026-11-18")!
      .sessions.find((s) => s.session.sport === "running")!.session;
    assert(moved.sport === "running");
    bookended(moved.workout);
    assert.equal(workoutKm(moved.workout, 375), 6);
    const undo = { action: "undo" as const, id: saved.id };
    service.apply(undo, service.preview(undo).revision);
    const restored = trainingCalendar(db, repo.plans()[0], [], now)
      .days.find((d) => d.day === "2026-11-17")!
      .sessions.find((s) => s.session.sport === "running")!.session;
    assert(restored.sport === "running");
    bookended(restored.workout);
    assert.equal(workoutKm(restored.workout, 375), 6);
    assert.deepEqual(
      db.prepare("SELECT plan_json FROM training_plans").get(),
      original,
    );
    const raw = buildWeekSchedule(
      plan,
      DEFAULT_WEEK_PREFERENCES,
      DEFAULT_PREFERENCES,
    );
    raw.days[0].sessions[0].status = "recorded";
    const adjusted = withCalendarBookends(raw, DEFAULT_TARGETS, "2026-11-17");
    assert.deepEqual(adjusted.days[0], raw.days[0]);
  } finally {
    db.close();
  }
});
