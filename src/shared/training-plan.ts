import type {
  PlanStep,
  RunWorkout,
  TrainingPlan,
  PlanTarget,
} from "./types/metrics";

export const volumeMilestones = [
  25, 27, 29, 23, 30, 32, 34, 27, 36, 39, 42, 36, 45, 48, 52, 44, 55, 58, 62,
  52, 64, 68, 72, 60, 70, 74, 78, 66, 76, 80,
];
export const defaultEasyPace = 375;
export const defaultTempoPace = 270;

export function targetText(target: PlanTarget) {
  return target.kind === "hr"
    ? `HR ${target.min}–${target.max} bpm`
    : `Pace ${formatPace(target.min)}–${formatPace(target.max)}/km`;
}
export function formatPace(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function amountText(step: Extract<PlanStep, { kind: "step" }>) {
  return step.amount.kind === "distance"
    ? `${(step.amount.meters / 1000).toFixed(2)} km`
    : formatPace(step.amount.seconds);
}
function estimatePace(
  step: Extract<PlanStep, { kind: "step" }>,
  easyPace: number,
) {
  return step.target.kind === "pace"
    ? (step.target.min + step.target.max) / 2
    : easyPace;
}
export function stepMeters(step: PlanStep, easyPace: number): number {
  if (step.kind === "repeat")
    return (
      step.times * step.steps.reduce((s, x) => s + stepMeters(x, easyPace), 0)
    );
  return step.amount.kind === "distance"
    ? step.amount.meters
    : (step.amount.seconds / estimatePace(step, easyPace)) * 1000;
}
export function stepSeconds(step: PlanStep, easyPace: number): number {
  if (step.kind === "repeat")
    return (
      step.times * step.steps.reduce((s, x) => s + stepSeconds(x, easyPace), 0)
    );
  return step.amount.kind === "time"
    ? step.amount.seconds
    : (step.amount.meters / 1000) * estimatePace(step, easyPace);
}
export function workoutKm(workout: RunWorkout, easyPace: number) {
  return (
    workout.steps.reduce((sum, step) => sum + stepMeters(step, easyPace), 0) /
    1000
  );
}
export function planKm(plan: TrainingPlan) {
  return plan.workouts.reduce((sum, w) => sum + workoutKm(w, plan.easyPace), 0);
}
function distanceStep(
  name: Extract<PlanStep, { kind: "step" }>["name"],
  meters: number,
  min: number,
  max: number,
): PlanStep {
  return {
    kind: "step",
    name,
    amount: { kind: "distance", meters },
    target: { kind: "hr", min, max },
  };
}

export function createTrainingPlan(
  weekNumber: number,
  start: string,
  easyPace = defaultEasyPace,
  tempoPace = defaultTempoPace,
  targetKm?: number,
): TrainingPlan {
  if (
    !Number.isInteger(weekNumber) ||
    weekNumber < 1 ||
    weekNumber > 30 ||
    easyPace < 240 ||
    easyPace > 600 ||
    tempoPace < 180 ||
    tempoPace > 420
  )
    throw new Error("Invalid plan settings");
  const volume = targetKm ?? volumeMilestones[weekNumber - 1];
  if (
    !Number.isFinite(volume) ||
    volume < 20 ||
    volume > volumeMilestones[weekNumber - 1]
  )
    throw new Error(
      "Reviewed volume must be between 20 km and the selected milestone",
    );
  const cutback =
    weekNumber % 4 === 0 || volume < volumeMilestones[weekNumber - 1] * 0.9;
  const allocation =
    volume < 40
      ? [
          [0, 0.15],
          [1, 0.23],
          [3, 0.28],
          [5, 0.34],
        ]
      : volume < 60
        ? [
            [0, 0.15],
            [1, 0.22],
            [2, 0.12],
            [3, 0.23],
            [5, 0.28],
          ]
        : [
            [0, 0.13],
            [1, 0.19],
            [2, 0.1],
            [3, 0.19],
            [4, 0.12],
            [5, 0.27],
          ];
  let allocated = 0;
  const workouts = allocation.map(([dayOffset, weight], i): RunWorkout => {
    const meters =
      i === allocation.length - 1
        ? volume * 1000 - allocated
        : Math.round(volume * weight * 10) * 100;
    allocated += meters;
    let type: RunWorkout["type"] =
      dayOffset === 5
        ? "long"
        : dayOffset === 1
          ? "strides"
          : dayOffset === 3 && !cutback
            ? "quality"
            : dayOffset === 2 || dayOffset === 4
              ? "recovery"
              : "base";
    if (cutback && type === "strides") type = "base";
    const warm =
      type === "quality"
        ? 1500
        : type === "long" || type === "strides"
          ? 1000
          : 500;
    const cool = 500;
    const extras: PlanStep[] =
      type === "quality"
        ? [
            {
              kind: "repeat",
              times: 2,
              steps: [
                {
                  kind: "step",
                  name: "Run",
                  amount: { kind: "time", seconds: 360 },
                  target: {
                    kind: "pace",
                    min: tempoPace - 5,
                    max: tempoPace + 10,
                  },
                },
                {
                  kind: "step",
                  name: "Recover",
                  amount: { kind: "time", seconds: 120 },
                  target: { kind: "pace", min: 375, max: 450 },
                },
              ],
            },
          ]
        : type === "strides"
          ? [
              {
                kind: "repeat",
                times: 6,
                steps: [
                  {
                    kind: "step",
                    name: "Run",
                    amount: { kind: "time", seconds: 20 },
                    target: { kind: "pace", min: 240, max: 270 },
                  },
                  {
                    kind: "step",
                    name: "Recover",
                    amount: { kind: "time", seconds: 100 },
                    target: { kind: "pace", min: 375, max: 450 },
                  },
                ],
              },
            ]
          : [];
    const remaining =
      meters -
      warm -
      cool -
      extras.reduce((sum, s) => sum + stepMeters(s, easyPace), 0);
    if (remaining <= 0)
      throw new Error("Workout target is too short for its steps");
    const recovery = type === "recovery";
    return {
      dayOffset,
      type,
      title:
        type === "quality"
          ? "Tempo · 2 × 6 min"
          : type === "strides"
            ? "Base + 6 × 20 sec strides"
            : type === "long"
              ? "Long base run"
              : recovery
                ? "Recovery run"
                : "Base run",
      steps: [
        distanceStep("Warm Up", warm, 125, 145),
        distanceStep(
          "Run",
          remaining,
          recovery ? 125 : 135,
          recovery ? 140 : type === "long" ? 150 : 148,
        ),
        ...extras,
        distanceStep("Cool Down", cool, 120, 140),
      ],
    };
  });
  return {
    weekNumber,
    start,
    targetKm: volume,
    easyPace,
    tempoPace,
    cutback,
    workouts,
  };
}

export function garminWorkoutText(workout: RunWorkout) {
  const lines = (steps: PlanStep[], indent = ""): string[] =>
    steps.flatMap((step) =>
      step.kind === "repeat"
        ? [
            `${indent}Repeat ${step.times} times`,
            ...lines(step.steps, indent + "  "),
          ]
        : [
            `${indent}${step.name} — ${amountText(step)} — ${targetText(step.target)}`,
          ],
    );
  return [workout.title, ...lines(workout.steps)].join("\n");
}
