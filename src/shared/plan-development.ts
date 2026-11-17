import { trainingCycle, type PlanningPolicy } from "./training-cycle";
import { createTrainingPlan, planKm } from "./training-plan";
import type { TrainingPlan } from "./types/metrics";
import {
  DEFAULT_TARGETS,
  type AthleteProfile,
  type PlanDevelopment,
} from "./types/athlete";
export function developedPlan(
  settings: {
    weekNumber: number;
    start: string;
    easyPace: number;
    tempoPace: number;
    targetKm?: number;
    policy?: PlanningPolicy;
  },
  profile: AthleteProfile,
  plans: TrainingPlan[],
  readiness: {
    eligible: boolean;
    level: number;
    referenceStart: string | null;
  },
) {
  const previous = [...plans]
    .filter((p) => p.start < settings.start)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  const existing = plans.find((p) => p.start === settings.start);
  if (
    existing &&
    existing.weekNumber === settings.weekNumber &&
    existing.easyPace === settings.easyPace &&
    existing.tempoPace === settings.tempoPace &&
    (settings.targetKm ?? existing.targetKm) === existing.targetKm &&
    JSON.stringify(existing.development?.targets ?? DEFAULT_TARGETS) ===
      JSON.stringify(profile.targets)
  )
    return existing;
  const cycle = trainingCycle(
    settings.weekNumber,
    settings.policy,
    settings.start,
  );
  const volume = settings.targetKm ?? cycle.km,
    prior = previous ? planKm(previous) : volume;
  let phase: PlanDevelopment["phase"] = cycle.cutback
    ? "cutback"
    : previous && volume < prior * 0.9
      ? "recovery"
      : volume > prior + 0.05
        ? previous?.cutback &&
          (previous.development?.phase === "cutback" ||
            (!previous.development &&
              trainingCycle(
                previous.weekNumber,
                previous.policy,
                previous.start,
              ).cutback))
          ? "return"
          : "volume"
        : "consolidate";
  let qualityLevel = previous?.development?.qualityLevel ?? 0;
  // Re-saving a week cannot increment quality repeatedly.
  if (existing?.development) qualityLevel = existing.development.qualityLevel;
  if (
    !existing &&
    previous &&
    (phase === "consolidate" || phase === "volume") &&
    volume <= prior * 1.1 + 0.01 &&
    settings.tempoPace === previous.tempoPace &&
    JSON.stringify(profile.targets) ===
      JSON.stringify(previous.development?.targets ?? DEFAULT_TARGETS) &&
    settings.start ===
      new Date(Date.parse(previous.start + "T12:00:00Z") + 7 * 86400000)
        .toISOString()
        .slice(0, 10) &&
    readiness.eligible &&
    previous.start === readiness.referenceStart &&
    qualityLevel === readiness.level &&
    qualityLevel < 6
  ) {
    phase = "quality";
    qualityLevel++;
  }
  const reason =
    phase === "recovery"
      ? "Reduce running demands for recovery; do not automatically restore an old peak after an unplanned reduction."
      : phase === "cutback"
        ? "Recover with less running and no tempo or strides."
        : phase === "return"
          ? "Review a return after the scheduled cutback. Completed training must clear the volume review; hold quality exposure."
          : phase === "volume"
            ? "Build running distance while holding quality exposure."
            : phase === "quality"
              ? "Propose one small tempo-distance step at the existing pace after repeated recorded quality-day runs and recovery review. Keep the weekly mileage budget; extra tempo replaces base distance."
              : "Consolidate distance and quality while collecting recovery and effort evidence.";
  return createTrainingPlan(
    settings.weekNumber,
    settings.start,
    settings.easyPace,
    settings.tempoPace,
    settings.targetKm,
    {
      phase,
      qualityLevel,
      reason,
      targets: profile.targets,
      reviewedAt: profile.reviewedAt,
    },
    settings.policy,
  );
}
