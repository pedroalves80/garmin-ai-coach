import type { RecoveryEvidence } from "../../shared/types/weekly-planning";
import { DEFAULT_TARGETS } from "../../shared/types/athlete";
import type { AthleteProfile, SessionEffort } from "../../shared/types/athlete";
import type {
  TrainingPlan,
  ActivityMeasurement,
  DailyCheckIn,
} from "../../shared/types/metrics";
import { stepMeters } from "../../shared/training-plan";
import { tempoWork, tempoLevelMeters } from "../../shared/tempo-progression";
import { countedActivityKm } from "../../shared/mileage";
import type { TempoObservation } from "./tempo-evidence";
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
  recovery?: RecoveryEvidence,
  execution: {
    observations: TempoObservation[];
    harderRecently: boolean;
    adverseRecently?: boolean;
  } = {
    observations: [],
    harderRecently: false,
  },
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
        .reduce((n, a) => n + countedActivityKm(a), 0)
    : 0;
  const adhered =
    !!previous &&
    previous.start > shiftDay(today, -14) &&
    completedKm >= previous.targetKm * 0.9;
  const ratings = new Map(efforts.map((e) => [e.activityId, e.rpe]));
  const used = new Set<string>();
  let aggregateEvidence = 0,
    confirmedEvidence = 0;
  const good = plans
    .filter(
      (p) =>
        p.start >= shiftDay(today, -42) &&
        shiftDay(p.start, 7) <= today &&
        !p.cutback &&
        !p.development?.qualityForecast &&
        p.tempoPace === profile.tempoPace &&
        JSON.stringify(p.development?.targets ?? DEFAULT_TARGETS) ===
          JSON.stringify(profile.targets) &&
        (p.development?.qualityLevel ?? 0) === level,
    )
    .filter((p) =>
      p.workouts.some((w) => {
        const work = tempoWork(w);
        if (!work || work.meters + 1 < tempoLevelMeters(level)) return false;
        const a = activities.find((a) => {
          if (
            used.has(a.id) ||
            sportGroup(a) !== "running" ||
            calendarDate(new Date(a.startedAt)) !==
              shiftDay(p.start, w.dayOffset) ||
            Date.parse(a.startedAt) > now.getTime()
          )
            return false;
          const distance = w.steps.reduce(
            (n, s) => n + stepMeters(s, p.easyPace),
            0,
          );
          if (
            countedActivityKm(a) * 1000 < distance * 0.9 ||
            countedActivityKm(a) * 1000 > distance * 1.2
          )
            return false;
          const rating = ratings.get(a.id);
          if (rating !== undefined && rating > 7) return false;
          const observation = execution.observations.find(
            (o) =>
              o.activityId === a.id &&
              Math.abs(o.meters - work.meters) < 1 &&
              o.min === work.min &&
              o.max === work.max,
          );
          if (observation?.adverse) return false;
          const confirmed =
            rating !== undefined &&
            rating >= 4 &&
            rating <= 7 &&
            efforts.some(
              (e) => e.activityId === a.id && e.prescriptionCompleted,
            );
          if (!confirmed && !observation) return false;
          if (confirmed) confirmedEvidence++;
          else if (observation?.aggregateSupported) aggregateEvidence++;
          return true;
        });
        if (!a) return false;
        used.add(a.id);
        return true;
      }),
    );
  const recent = checkIns.filter(
    (c) => c.day <= today && c.day >= shiftDay(today, -6),
  );
  const recovered =
    (recent.length > 0 || recovery?.status === "supportive") &&
    recovery?.status !== "caution" &&
    recent.every((c) => !c.pain && c.fatigue <= 2 && c.soreness <= 2);
  const eligible =
    syncFresh &&
    adhered &&
    good.length >= 2 &&
    recovered &&
    !execution.harderRecently &&
    !execution.adverseRecently &&
    load.latest.hardDays <= 3 &&
    (load.change === null || load.change <= 0.15);
  return {
    eligible,
    level,
    referenceStart: previous?.start ?? null,
    calibrationFresh: fresh,
    qualityEvidence: good.length,
    aggregateEvidence,
    confirmedEvidence,
    unverifiedEvidence: good.length - aggregateEvidence - confirmedEvidence,
    reviewDue: !fresh,
    reason: !syncFresh
      ? "Sync current Garmin data before developing quality."
      : !adhered
        ? "Complete a recent running week before developing quality."
        : good.length < 2
          ? "Record at least two recent quality-day runs at the current tempo dose and pace before proposing more tempo distance. Matched Garmin recordings can supply this evidence; ratings are optional."
          : !recovered
            ? "Keep the current tempo dose while recovery evidence is uncertain or flagged. No daily check-in is required."
            : execution.harderRecently
              ? "Recent optional feedback reported harder-than-planned effort; hold extra tempo distance for review."
              : execution.adverseRecently
                ? "Recent isolated tempo averages differ from the prescribed pace; review execution before adding tempo distance."
                : load.latest.hardDays > 3 ||
                    (load.change !== null && load.change > 0.15)
                  ? "Measured demanding days or combined effort warrant holding extra tempo distance."
                  : `${good.length} recent quality-day runs and recovery evidence support reviewing one small tempo-distance increase at the same pace. ${good.length - aggregateEvidence - confirmedEvidence} have unverified interval execution; a full-session recording is not proof of every rep. Pace changes require a separate current target review.`,
  };
}
