import { DEFAULT_TARGETS, type PlanDevelopment } from "./types/athlete";
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
export const minimumRunKm = 5;

// Constrain the weighted split before rounding, preserving the reviewed total.
function allocateDistances(total: number, weights: number[]): number[] {
  const minimum = minimumRunKm * 1000;
  if (total < weights.length * minimum)
    throw new Error("Weekly distance cannot support 5 km per run");
  const distances = weights.map(() => 0);
  let active = weights.map((_, i) => i),
    remaining = total;
  while (active.length) {
    const weight = active.reduce((sum, i) => sum + weights[i], 0);
    const below = active.filter(
      (i) => (remaining * weights[i]) / weight < minimum,
    );
    if (!below.length) {
      for (const i of active) distances[i] = (remaining * weights[i]) / weight;
      break;
    }
    for (const i of below) {
      distances[i] = minimum;
      remaining -= minimum;
    }
    active = active.filter((i) => !below.includes(i));
  }
  const rounded = distances.map((m) => Math.floor((m + 1e-7) / 10) * 10);
  const order = distances
    .map((m, i) => ({ i, remainder: m - rounded[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const extra = Math.round((total - rounded.reduce((s, m) => s + m, 0)) / 10);
  for (let i = 0; i < extra; i++) rounded[order[i % order.length].i] += 10;
  return rounded;
}

export function isDistanceWorkout(workout: RunWorkout) {
  const distanceOnly = (steps: PlanStep[]): boolean =>
    steps.every((s) =>
      s.kind === "repeat"
        ? distanceOnly(s.steps)
        : s.amount.kind === "distance",
    );
  return distanceOnly(workout.steps);
}

export function formatWorkoutDistance(workout: RunWorkout, easyPace: number) {
  return `${isDistanceWorkout(workout) ? "" : "≈"}${workoutKm(workout, easyPace).toFixed(2)} km`;
}

export function targetText(target: PlanTarget) {
  if (target.kind === "effort")
    return `Garmin target: none · Instructions: RPE ${target.min}–${target.max} (race effort)`;
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
  development?: PlanDevelopment,
): TrainingPlan {
  if (
    !Number.isInteger(weekNumber) ||
    weekNumber < 1 ||
    weekNumber > 30 ||
    !Number.isFinite(easyPace) ||
    !Number.isFinite(tempoPace) ||
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
  if (Math.abs(volume * 100 - Math.round(volume * 100)) > 1e-6)
    throw new Error("Use weekly volume in increments of 0.01 km");
  const cutback =
    weekNumber % 4 === 0 ||
    (development
      ? ["cutback", "recovery"].includes(development.phase)
      : volume < volumeMilestones[weekNumber - 1] * 0.9);
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
  const distances = allocateDistances(
    Math.round(volume * 1000),
    allocation.map(([, weight]) => weight),
  );
  const targets = development?.targets ?? DEFAULT_TARGETS;
  const levels = [
    [2, 1000],
    [2, 1300],
    [3, 1000],
    [2, 1800],
    [3, 1400],
    [2, 2400],
    [3, 1800],
  ];
  let qualityLevel = Math.min(6, Math.max(0, development?.qualityLevel ?? 1));
  const qualityDistance = distances[allocation.findIndex(([day]) => day === 3)];
  while (
    qualityLevel > 0 &&
    2000 + levels[qualityLevel][0] * (levels[qualityLevel][1] + 300) + 100 >
      qualityDistance
  )
    qualityLevel--;
  const [repetitions, repMeters] = levels[qualityLevel];
  const workouts = allocation.map(([dayOffset], i): RunWorkout => {
    const meters = distances[i];
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
              times: repetitions,
              steps: [
                {
                  kind: "step",
                  name: "Run",
                  amount: { kind: "distance", meters: repMeters },
                  target: {
                    kind: "pace",
                    min: tempoPace - 5,
                    max: tempoPace + 10,
                  },
                },
                {
                  kind: "step",
                  name: "Recover",
                  amount: { kind: "distance", meters: 300 },
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
                    amount: { kind: "distance", meters: 80 },
                    target: {
                      kind: "pace",
                      min: targets.strideMin,
                      max: targets.strideMax,
                    },
                  },
                  {
                    kind: "step",
                    name: "Recover",
                    amount: { kind: "distance", meters: 250 },
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
          ? `Tempo · ${repetitions} × ${(repMeters / 1000).toFixed(2)} km`
          : type === "strides"
            ? "Base + 6 × 0.08 km strides"
            : type === "long"
              ? "Long base run"
              : recovery
                ? "Recovery run"
                : "Base run",
      steps: [
        distanceStep(
          "Warm Up",
          warm,
          development ? targets.recoveryMin : 125,
          development ? targets.recoveryMax : 145,
        ),
        distanceStep(
          "Run",
          remaining,
          recovery
            ? targets.recoveryMin
            : type === "long"
              ? targets.longMin
              : targets.baseMin,
          recovery
            ? targets.recoveryMax
            : type === "long"
              ? targets.longMax
              : targets.baseMax,
        ),
        ...extras,
        distanceStep(
          "Cool Down",
          cool,
          development ? targets.recoveryMin : 120,
          development ? targets.recoveryMax : 140,
        ),
      ],
    };
  });
  return {
    ...(development
      ? {
          development: {
            ...development,
            qualityLevel: cutback ? development.qualityLevel : qualityLevel,
          },
        }
      : {}),
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
