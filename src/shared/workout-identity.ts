import type { PlanStep, RunWorkout } from "./types/metrics";

// Compare fields, not object insertion order (schema parsing reorders keys).
function stepsIdentity(steps: PlanStep[]): unknown[] {
  return steps.map((s) =>
    s.kind === "repeat"
      ? ["repeat", s.times, stepsIdentity(s.steps)]
      : [
          s.name,
          s.amount.kind,
          s.amount.kind === "distance" ? s.amount.meters : s.amount.seconds,
          s.target.kind,
          s.target.min,
          s.target.max,
        ],
  );
}
export function sameWorkout(a: RunWorkout, b: RunWorkout) {
  const identity = (w: RunWorkout) =>
    JSON.stringify([
      w.dayOffset,
      w.title,
      w.type,
      stepsIdentity(w.steps),
      w.calendarAdjustment
        ? [w.calendarAdjustment.raceId, w.calendarAdjustment.phase]
        : null,
      w.trail
        ? [
            w.trail.expectedMinutes,
            w.trail.ascentM ?? null,
            w.trail.road?.title,
            w.trail.road ? stepsIdentity(w.trail.road.steps) : null,
          ]
        : null,
    ]);
  return identity(a) === identity(b);
}
