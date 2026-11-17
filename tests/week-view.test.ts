import { milestoneForWeek, distributeMileage } from "../src/shared/milestones";
import test from "node:test";
import assert from "node:assert/strict";
import {
  weekView,
  weekMonday,
  attendanceForWeek,
  planDayHref,
  planDayFromQuery,
} from "../src/shared/week-view";
import { raceImpactWeeks, compareRaceImpact } from "../src/shared/race-impact";
import { createTrainingPlan, workoutKm } from "../src/shared/training-plan";
import { buildWeekSchedule } from "../src/shared/weekly-schedule";
import { DEFAULT_ATHLETE, DEFAULT_TARGETS } from "../src/shared/types/athlete";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_WEEK_PREFERENCES,
} from "../src/shared/types/schedule";
import type { RaceEvent } from "../src/shared/types/commitments";
const monday = "2026-11-09",
  today = "2026-11-10";
const current = createTrainingPlan(2, monday, 375, 270, 26.3);
const future = createTrainingPlan(3, "2026-11-16", 375, 270, 26.3);
const context = {
  monday,
  plans: [current, future],
  prepared: current,
  athlete: DEFAULT_ATHLETE,
};
function race(extra: Partial<RaceEvent> = {}): RaceEvent {
  return {
    id: "trail",
    name: "Trail 18km",
    day: "2026-11-22",
    startTime: "09:00",
    distanceKm: 18,
    terrain: "trail",
    elevationGain: 900,
    expectedMinutes: 150,
    priority: "goal",
    status: "planned",
    createdAt: "2026-11-10T20:00:00Z",
    updatedAt: "2026-11-10T20:00:00Z",
    ...extra,
  };
}
test("browsing a saved future week preserves its stage, distance and exact custom steps", () => {
  const custom = structuredClone(future);
  custom.workouts[0].title = "Reviewed custom session";
  const before = JSON.stringify(custom);
  const view = weekView(future.start, { ...context, plans: [current, custom] });
  assert.equal(view.kind, "reviewed");
  assert.equal(view.plan.weekNumber, 3);
  assert.equal(view.plan.targetKm, 26.3);
  assert.equal(JSON.stringify(view.plan), before);
  assert.equal(weekView(monday, context).plan, current);
});
test("unsaved cutback forecasts retain recovery and never activate training", () => {
  const before = JSON.stringify(context);
  const view = weekView("2026-11-23", context);
  assert.equal(view.kind, "projection");
  assert.equal(view.plan.weekNumber, 4);
  assert.equal(view.plan.targetKm, 23);
  assert.equal(view.plan.development?.qualityLevel, 0);
  assert(view.plan.workouts.every((w) => workoutKm(w, 375) >= 5));
  assert.equal(JSON.stringify(context), before);
});
test("browsing back to this week uses the prepared plan and past gaps never invent completed prescriptions", () => {
  assert.equal(weekView(monday, { ...context, plans: [] }).plan, current);
  assert.equal(weekView(monday, { ...context, plans: [] }).kind, "prepared");
  assert.equal(weekView("2026-11-02", context).kind, "unplanned");
  assert.equal(weekView("2026-11-02", context).plan.workouts.length, 0);
  assert.equal(weekMonday("2026-11-22"), "2026-11-16");
  assert.throws(() => weekMonday("2026-02-31"));
});
test("future browsing carries reviewed attendance without replacing an explicitly saved selection", () => {
  const preferences = {
    ...DEFAULT_WEEK_PREFERENCES,
    hyrox: {
      monday: "going" as const,
      wednesday: "going" as const,
      friday: "skipping" as const,
    },
  };
  assert.equal(
    attendanceForWeek("2026-11-23", {}, monday, preferences),
    preferences,
  );
  assert.equal(
    attendanceForWeek(
      "2026-11-16",
      { "2026-11-16": DEFAULT_WEEK_PREFERENCES },
      monday,
      preferences,
    ),
    DEFAULT_WEEK_PREFERENCES,
  );
});
test("November 22 goal trail race previews current, race and recovery weeks, while a distant road race does not affect this week", () => {
  assert.deepEqual(raceImpactWeeks(race(), undefined, today), [
    "2026-11-09",
    "2026-11-16",
    "2026-11-23",
  ]);
  assert(
    !raceImpactWeeks(
      race({
        day: "2026-12-05",
        terrain: "road",
        distanceKm: 10,
        elevationGain: 80,
      }),
      undefined,
      today,
    ).includes(monday),
  );
  const starts = raceImpactWeeks(race({ day: "2026-12-05" }), race(), today);
  assert(starts.includes(monday));
  assert(starts.includes("2026-12-07"));
});
test("race impact explains current-week reductions while preserving baseline plans and completed activities", () => {
  const baseline = buildWeekSchedule(
    current,
    DEFAULT_WEEK_PREFERENCES,
    DEFAULT_PREFERENCES,
    [],
    [{ day: monday, sport: "running", minutes: 32, km: 5 }],
  );
  const before = JSON.stringify({ current, baseline });
  const impact = compareRaceImpact({
    plan: current,
    baseline,
    before: { races: [], pauses: [] },
    after: { races: [race()], pauses: [] },
    targets: DEFAULT_TARGETS,
    options: { today, returnReady: true },
    availability: [],
  });
  assert.equal(impact.beforeKm, 26.3);
  assert(impact.afterKm < 26.3);
  assert.equal(impact.changed, true);
  assert.equal(JSON.stringify({ current, baseline }), before);
  assert.equal(
    baseline.days[0].sessions.find((s) => s.session.sport === "running")
      ?.status,
    "recorded",
  );
  const distant = compareRaceImpact({
    plan: current,
    baseline,
    before: { races: [], pauses: [] },
    after: {
      races: [
        race({
          day: "2026-12-05",
          terrain: "road",
          distanceKm: 10,
          elevationGain: 80,
        }),
      ],
      pauses: [],
    },
    targets: DEFAULT_TARGETS,
    options: { today, returnReady: true },
    availability: [],
  });
  assert.equal(distant.changed, false);
  assert.equal(distant.afterKm, 26.3);
});

test("event links select the race day in its saved week without activating or changing plans", () => {
  const before = JSON.stringify(context);
  const day = planDayFromQuery("2026-11-22", "2026-11-02", "2028-11-06");
  assert.equal(planDayHref("2026-11-22"), "/plan?date=2026-11-22");
  assert.equal(day, "2026-11-22");
  assert.equal(weekView(weekMonday(day!), context).plan, future);
  assert.equal(JSON.stringify(context), before);
});
test("invalid or out-of-range plan date links fall back to the current week", () => {
  for (const raw of [
    null,
    "",
    "2026-02-31",
    "https://example.com",
    "2020-01-01",
    "2030-01-01",
  ])
    assert.equal(planDayFromQuery(raw, "2026-11-02", "2028-11-06"), undefined);
  assert.throws(() => planDayHref("not-a-date"));
});

test("calendar milestones forecast 25,27,29,23,30 without a repeated legacy stage moving the anchor", () => {
  const first = createTrainingPlan(1, "2026-11-02"),
    stale = createTrainingPlan(2, "2026-11-16", 375, 270, 26.3);
  const ctx = { ...context, plans: [first, current, stale], prepared: current };
  for (const [date, stage, km] of [
    ["2026-11-02", 1, 25],
    ["2026-11-09", 2, 27],
    ["2026-11-16", 3, 29],
    ["2026-11-23", 4, 23],
    ["2026-11-30", 5, 30],
  ] as const)
    assert.deepEqual(milestoneForWeek(date, ctx.plans), {
      stage,
      km,
      anchor: "2026-11-02",
    });
  const before = JSON.stringify(ctx.plans),
    view = weekView(stale.start, ctx);
  assert.equal(view.kind, "correction");
  assert.equal(view.plan.weekNumber, 3);
  assert.equal(view.plan.targetKm, 29);
  assert.equal(JSON.stringify(ctx.plans), before);
  const plan = createTrainingPlan(2, "2026-11-09");
  assert.equal(
    distributeMileage(createTrainingPlan(30, "2027-05-24"), 5),
    null,
    "A distant milestone cannot bypass current run-distance capacity",
  );
  const fitted = distributeMileage(plan, 8.14)!;
  assert(fitted);
  assert.equal(
    fitted.workouts.reduce((n, w) => n + workoutKm(w, 375), 0),
    27,
  );
  assert(fitted.workouts.every((w) => workoutKm(w, 375) <= 8.954 + 1e-8));
});

test("redistributing a reduced recovery week never raises its running intensity", () => {
  const base = createTrainingPlan(23, "2027-04-05", 375, 270, 60);
  const recovery = {
    ...base,
    workouts: base.workouts.map((w) => ({
      ...w,
      type: "recovery" as const,
      steps: [
        {
          kind: "step" as const,
          name: "Run" as const,
          amount: {
            kind: "distance" as const,
            meters: workoutKm(w, 375) * 1000,
          },
          target: { kind: "hr" as const, min: 125, max: 140 },
        },
      ],
    })),
  };
  const fitted = distributeMileage(recovery, 12);
  assert(fitted);
  assert.equal(
    fitted.workouts.reduce((n, w) => n + workoutKm(w, 375), 0),
    60,
  );
  assert(
    fitted.workouts.every(
      (w) =>
        w.type === "recovery" &&
        w.steps.every(
          (s) =>
            s.kind === "step" && s.target.kind === "hr" && s.target.max <= 140,
        ),
    ),
  );
});
