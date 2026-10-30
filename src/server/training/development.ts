import { DEFAULT_TARGETS } from "../../shared/types/athlete";
import type { AthleteProfile, SessionEffort } from "../../shared/types/athlete";
import type {
  TrainingPlan,
  ActivityMeasurement,
  DailyCheckIn,
} from "../../shared/types/metrics";
import { stepMeters } from "../../shared/training-plan";
import { calendarDate, shiftDay } from "./dates";
import { sportGroup } from "./metrics";
import type { combinedLoadReview } from "./load";
export function developmentReadiness(
  profile: AthleteProfile,
  plans: TrainingPlan[],
  activities: ActivityMeasurement[],
  efforts: SessionEffort[],
  checkIns: DailyCheckIn[],
  load: ReturnType<typeof combinedLoadReview>,
  now: Date,
  lastSync?: string | null,
) {
  const today = calendarDate(now),
    fresh =
      profile.calibrationSource !== "provisional" &&
      !!profile.reviewedAt &&
      profile.reviewedAt <= today &&
      profile.reviewedAt >= shiftDay(today, -42);
  const previous = [...plans]
    .filter((p) => shiftDay(p.start, 7) <= today)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  const level = previous?.development?.qualityLevel ?? 0;
  const syncFresh =
    !!lastSync &&
    Date.parse(lastSync) <= now.getTime() &&
    now.getTime() - Date.parse(lastSync) <= 2 * 86400000;
  const completedKm = previous
    ? activities
        .filter(
          (a) =>
            sportGroup(a) === "running" &&
            calendarDate(new Date(a.startedAt)) >= previous.start &&
            calendarDate(new Date(a.startedAt)) < shiftDay(previous.start, 7) &&
            Date.parse(a.startedAt) <= now.getTime(),
        )
        .reduce((n, a) => n + (a.distanceMeters ?? 0) / 1000, 0)
    : 0;
  const adhered =
    !!previous &&
    previous.start > shiftDay(today, -14) &&
    completedKm >= previous.targetKm * 0.9;
  const ratings = new Map(efforts.map((e) => [e.activityId, e.rpe]));
  const good = plans
    .filter(
      (p) =>
        p.start >= shiftDay(today, -28) &&
        shiftDay(p.start, 7) <= today &&
        !p.cutback &&
        p.tempoPace === profile.tempoPace &&
        JSON.stringify(p.development?.targets ?? DEFAULT_TARGETS) ===
          JSON.stringify(profile.targets) &&
        (p.development?.qualityLevel ?? 0) === level,
    )
    .filter((p) =>
      p.workouts.some(
        (w) =>
          w.type === "quality" &&
          activities.some(
            (a) =>
              sportGroup(a) === "running" &&
              calendarDate(new Date(a.startedAt)) ===
                shiftDay(p.start, w.dayOffset) &&
              Date.parse(a.startedAt) <= now.getTime() &&
              (a.distanceMeters ?? 0) >=
                w.steps.reduce((n, s) => n + stepMeters(s, p.easyPace), 0) *
                  0.9 &&
              (ratings.get(a.id) ?? 11) <= 7 &&
              (ratings.get(a.id) ?? 0) >= 4 &&
              efforts.some(
                (e) => e.activityId === a.id && e.prescriptionCompleted,
              ),
          ),
      ),
    );
  const recent = checkIns.filter(
    (c) => c.day <= today && c.day >= shiftDay(today, -6),
  );
  const recovered =
    recent.length >= 3 &&
    recent.some((c) => c.day >= shiftDay(today, -1)) &&
    recent.every((c) => !c.pain && c.fatigue <= 2 && c.soreness <= 2);
  const eligible =
    fresh &&
    syncFresh &&
    adhered &&
    good.length >= 2 &&
    recovered &&
    load.cleared;
  return {
    eligible,
    level,
    referenceStart: previous?.start ?? null,
    calibrationFresh: fresh,
    qualityEvidence: good.length,
    reviewDue: !fresh,
    reason: !syncFresh
      ? "Sync current Garmin data before developing quality."
      : !adhered
        ? "Complete a recent running week before developing quality."
        : !fresh
          ? "Review pace/HR targets with current field, lab or coach evidence before developing quality."
          : good.length < 2
            ? "Complete and rate at least two quality sessions at this level before developing tempo duration."
            : !recovered
              ? "Consolidate while recovery settles."
              : !load.cleared
                ? load.reasons[0]
                : "Current targets, completed quality sessions and recovery support reviewing the next quality level.",
  };
}
