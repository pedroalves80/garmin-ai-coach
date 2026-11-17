import { trainingCycle, type PlanningPolicy } from "./training-cycle";
import type { TrainingPlan, RunWorkout } from "./types/metrics";
import { workoutKm } from "./training-plan";
import { DEFAULT_TARGETS } from "./types/athlete";
export function milestoneForWeek(
  start: string,
  plans: TrainingPlan[],
  policy?: PlanningPolicy,
) {
  const previous = plans
    .filter((p) => p.start <= start)
    .sort((a, b) => a.start.localeCompare(b.start));
  const anchor =
    previous.filter((p) => p.weekNumber === 1).at(-1) ?? previous[0];
  const stage = anchor
    ? Math.max(
        1,
        anchor.weekNumber +
          Math.round(
            (Date.parse(start + "T12:00:00Z") -
              Date.parse(anchor.start + "T12:00:00Z")) /
              (7 * 86400000),
          ),
      )
    : 1;
  return {
    stage,
    km: trainingCycle(stage, policy, start).km,
    anchor: anchor?.start ?? start,
  };
}
// Spread a weekly increase across ordinary runs before lengthening the longest one.
export function distributeMileage(
  plan: TrainingPlan,
  longestRecentKm: number,
): TrainingPlan | null {
  if (longestRecentKm <= 0) return plan;
  const limit = Math.max(5000, Math.floor(longestRecentKm * 1.1 * 1000));
  const sizes = plan.workouts.map((w) =>
    Math.round(workoutKm(w, plan.easyPace) * 1000),
  );
  const caps = plan.workouts.map((w) =>
    w.dayOffset < 5
      ? Math.min(limit, Math.floor((7200 / plan.easyPace) * 1000))
      : limit,
  );
  const result = sizes.map((n, i) => Math.min(n, caps[i]));
  let excess = sizes.reduce((n, v, i) => n + v - result[i], 0);
  const order = plan.workouts
    .map((_, i) => i)
    .sort(
      (a, b) =>
        Number(!["base", "recovery"].includes(plan.workouts[a].type)) -
        Number(!["base", "recovery"].includes(plan.workouts[b].type)),
    );
  for (const i of order) {
    const add = Math.min(excess, Math.max(0, caps[i] - result[i]));
    result[i] += add;
    excess -= add;
  }
  if (excess > 0) return null;
  const targets = plan.development?.targets ?? DEFAULT_TARGETS;
  const resize = (w: RunWorkout, meters: number): RunWorkout => {
    if (meters === Math.round(workoutKm(w, plan.easyPace) * 1000)) return w;
    // A lower-intensity distance step is preferable to stretching interval repetitions.
    return {
      ...w,
      title:
        w.type === "long"
          ? "Long base run · distributed mileage"
          : w.type === "recovery"
            ? "Recovery run · distributed mileage"
            : "Base run · distributed mileage",
      type:
        w.type === "long"
          ? "long"
          : w.type === "recovery"
            ? "recovery"
            : "base",
      steps: [
        {
          kind: "step",
          name: "Warm Up",
          amount: { kind: "distance", meters: 500 },
          target: {
            kind: "hr",
            min: targets.recoveryMin,
            max: targets.recoveryMax,
          },
        },
        {
          kind: "step",
          name: "Run",
          amount: { kind: "distance", meters: meters - 1000 },
          target: {
            kind: "hr",
            min:
              w.type === "recovery"
                ? targets.recoveryMin
                : w.type === "long"
                  ? targets.longMin
                  : targets.baseMin,
            max:
              w.type === "recovery"
                ? targets.recoveryMax
                : w.type === "long"
                  ? targets.longMax
                  : targets.baseMax,
          },
        },
        {
          kind: "step",
          name: "Cool Down",
          amount: { kind: "distance", meters: 500 },
          target: {
            kind: "hr",
            min: targets.recoveryMin,
            max: targets.recoveryMax,
          },
        },
      ],
    };
  };
  return {
    ...plan,
    workouts: plan.workouts.map((w, i) => resize(w, result[i])),
  };
}
