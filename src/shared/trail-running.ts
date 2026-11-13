import type { PlanStep, RunWorkout } from "./types/metrics";

export const TRAIL_GUIDANCE =
  "Follow the step RPE on a 1–10 scale, keeping conversation in full sentences. Hike steep climbs to control effort; do not chase road pace. Use HR as feedback: slow down if it stays unusually high rather than treating every brief rise as a failed target. Descend with short, controlled steps; no downhill sprints. Start with familiar, less technical trails. Increase climbing or technical difficulty separately from distance. Review Friday Hyrox and Saturday cycling if legs are tired or the outing is much longer.";

export function trailSteps(steps: PlanStep[]): PlanStep[] {
  return steps.map((step) =>
    step.kind === "repeat"
      ? { ...step, steps: trailSteps(step.steps) }
      : {
          ...step,
          target: {
            kind: "effort",
            min: step.name === "Run" ? 3 : 2,
            max: step.name === "Run" ? 4 : 3,
          },
        },
  );
}

export function longRunTerrain(
  workout: RunWorkout,
  terrain: "road" | "trail",
  expectedMinutes?: number,
  ascentM?: number,
): RunWorkout {
  if (workout.type !== "long" || workout.race)
    throw new Error("Only an ordinary long run can change terrain.");
  if (terrain === "road") {
    if (!workout.trail?.road)
      throw new Error("This long run is already on road.");
    const { trail, ...rest } = workout;
    return {
      ...rest,
      title: trail.road!.title,
      steps: structuredClone(trail.road!.steps),
    };
  }
  if (
    !Number.isInteger(expectedMinutes) ||
    expectedMinutes! < 15 ||
    expectedMinutes! > 1440
  )
    throw new Error(
      "Estimate the total trail outing duration (15–1440 minutes), including hiking.",
    );
  if (
    ascentM !== undefined &&
    (!Number.isInteger(ascentM) || ascentM < 0 || ascentM > 10000)
  )
    throw new Error("Estimated ascent must be 0–10000 metres.");
  return {
    ...workout,
    title: "Trail long run",
    steps: trailSteps(workout.steps),
    trail: {
      expectedMinutes: expectedMinutes!,
      ...(ascentM !== undefined ? { ascentM } : {}),
      road: workout.trail?.road ?? {
        title: workout.title,
        steps: structuredClone(workout.steps),
      },
    },
  };
}
export function trailSummary(workout: RunWorkout) {
  return workout.trail
    ? `Trail · estimated ${workout.trail.expectedMinutes} min including hiking${workout.trail.ascentM !== undefined ? ` · +${workout.trail.ascentM} m ascent` : " · ascent not specified"}. Duration and ascent are planning estimates, not targets.`
    : "";
}
