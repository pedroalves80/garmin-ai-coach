import type { PlanStep, PlanTarget, RunWorkout } from "./types/metrics";
import type { RunningTargets } from "./types/athlete";
import type { WeekSchedule } from "./types/schedule";

// The bookends divide the prescribed distance; they never add running volume.
export function aerobicDistanceSteps(
  meters: number,
  main: PlanTarget,
  targets: RunningTargets,
): PlanStep[] {
  if (!Number.isFinite(meters) || meters <= 1000)
    throw new Error("An ordinary structured run needs more than 1 km total.");
  const gentle: PlanTarget =
    main.kind === "hr"
      ? {
          kind: "hr",
          min: Math.min(targets.recoveryMin, main.min),
          max: Math.min(targets.recoveryMax, main.max),
        }
      : main.kind === "effort"
        ? {
            kind: "effort",
            min: Math.min(2, main.min),
            max: Math.min(3, main.max),
          }
        : { ...main };
  return (
    [
      ["Warm Up", 500, gentle],
      ["Run", meters - 1000, main],
      ["Cool Down", 500, gentle],
    ] as const
  ).map(([name, distance, target]) => ({
    kind: "step",
    name,
    amount: { kind: "distance", meters: distance },
    target: { ...target },
  }));
}

export function withRunBookends(
  workout: RunWorkout,
  targets: RunningTargets,
): RunWorkout {
  if (
    workout.race ||
    workout.type === "quality" ||
    workout.type === "strides" ||
    workout.steps.length !== 1
  )
    return workout;
  const step = workout.steps[0];
  if (
    step.kind !== "step" ||
    step.name !== "Run" ||
    step.amount.kind !== "distance" ||
    step.amount.meters <= 1000
  )
    return workout;
  return {
    ...workout,
    steps: aerobicDistanceSteps(step.amount.meters, step.target, targets),
  };
}

// Adapt legacy saved single-step prescriptions on read, after rest/recording rules.
// Stored plans, recorded sessions, past days and multi-step workouts stay intact.
export function withCalendarBookends(
  calendar: WeekSchedule,
  targets: RunningTargets,
  today: string,
): WeekSchedule {
  return {
    ...calendar,
    days: calendar.days.map((day) =>
      day.day < today
        ? day
        : {
            ...day,
            sessions: day.sessions.map((entry) =>
              entry.status !== "planned" || entry.session.sport !== "running"
                ? entry
                : {
                    ...entry,
                    session: {
                      ...entry.session,
                      workout: withRunBookends(entry.session.workout, targets),
                    },
                  },
            ),
          },
    ),
  };
}
