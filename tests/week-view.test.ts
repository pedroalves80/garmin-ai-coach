import test from "node:test";
import assert from "node:assert/strict";
import {
  weekView,
  weekMonday,
  attendanceForWeek,
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
const future = createTrainingPlan(2, "2026-11-16", 375, 270, 26.3);
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
  assert.equal(view.plan.weekNumber, 2);
  assert.equal(view.plan.targetKm, 26.3);
  assert.equal(JSON.stringify(view.plan), before);
  assert.equal(weekView(monday, context).plan, current);
});
test("unsaved future weeks are provisional and do not jump to a milestone ceiling or develop quality", () => {
  const before = JSON.stringify(context);
  const view = weekView("2026-11-23", context);
  assert.equal(view.kind, "projection");
  assert.equal(view.plan.weekNumber, 3);
  assert.equal(view.plan.targetKm, 26.3);
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
