import type {
  ActivityMeasurement,
  DailyCheckIn,
  ProgressionDecision,
  TrainingPlan,
  TrainingWeek,
} from "../../shared/types/metrics";
import {
  planKm,
  workoutKm,
  volumeMilestones,
} from "../../shared/training-plan";
import { calendarDate, shiftDay } from "./dates";
import { sportGroup } from "./metrics";

export function assessProgression(input: {
  now: Date;
  plans: TrainingPlan[];
  weeks: TrainingWeek[];
  checkIns: DailyCheckIn[];
  activities: ActivityMeasurement[];
  lastSync: string | null;
}): ProgressionDecision {
  const today = calendarDate(input.now);
  const recent = input.checkIns.filter(
    (x) => x.day <= today && x.day >= shiftDay(today, -6),
  );
  const reference = [...input.plans]
    .filter((p) => p.start <= today)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  const km = reference ? planKm(reference) : null;
  const result = (
    decision: ProgressionDecision["decision"],
    reason: string,
    suggestedKm: number | null = km,
  ): ProgressionDecision => ({ decision, reasons: [reason], suggestedKm });
  if (recent.some((x) => x.day >= shiftDay(today, -2) && x.pain > 0))
    return result(
      "reduce",
      "Pain was reported in the last three days. Pause volume increases and review the next run before resuming.",
      null,
    );
  if (
    recent.some(
      (x) =>
        x.day >= shiftDay(today, -2) && (x.fatigue >= 4 || x.soreness >= 4),
    )
  )
    return result(
      "reduce",
      "High fatigue or soreness was reported recently. A lighter week is suggested.",
      km === null ? null : Math.round(km * 0.85),
    );
  if (
    !input.lastSync ||
    Date.parse(input.lastSync) < input.now.getTime() - 2 * 86400000
  )
    return result(
      "hold",
      "Sync Garmin before reviewing progression; the activity data is missing or stale.",
    );
  if (!reference)
    return result(
      "hold",
      "Save a starting week to establish a plan baseline. Future milestones are previews.",
      null,
    );
  if (shiftDay(reference.start, 7) > today)
    return result(
      "hold",
      "This training week is still in progress. Review progression after Sunday; missed distance is not judged midweek.",
    );
  if (shiftDay(reference.start, 14) <= today)
    return result(
      "hold",
      "The latest saved plan is too old. Save a current baseline before progressing.",
    );
  const actual = input.weeks.find((w) => w.start === reference.start);
  if (!actual || actual.runningKm < km! * 0.9)
    return result(
      "hold",
      "Less than 90% of the saved running distance was recorded. Repeat or review the week before increasing.",
    );
  if (recent.length < 3 || !recent.some((x) => x.day >= shiftDay(today, -1)))
    return result(
      "hold",
      "Log at least three check-ins over the last seven days, including today or yesterday, to review recovery.",
    );
  if (recent.some((x) => x.fatigue > 2 || x.soreness > 2))
    return result(
      "hold",
      "Recovery check-ins are not consistently low-fatigue yet. Keep volume steady.",
    );
  const prior = input.weeks.filter((w) => w.start < reference.start);
  const other = (week: TrainingWeek) =>
    week.cyclingMinutes + week.hyroxMinutes + week.otherMinutes;
  const baseline = prior.length
    ? prior.reduce((s, w) => s + other(w), 0) / prior.length
    : 0;
  if (baseline > 0 && other(actual) > baseline * 1.25)
    return result(
      "hold",
      "Cycling, Hyrox or other training time rose substantially. Hold running volume while reviewing the combined workload.",
    );
  const nextMilestone = volumeMilestones[Math.min(reference.weekNumber, 29)];
  if (nextMilestone < km!)
    return result(
      "reduce",
      "The next stage is a scheduled cutback. Review a lighter week before building again.",
      nextMilestone,
    );
  if (km! >= 79.95)
    return result(
      "hold",
      "The 80 km milestone is reached. Consolidate this volume and review the next training block.",
    );
  const longestRecent = Math.max(
    0,
    ...input.activities
      .filter(
        (a) =>
          sportGroup(a) === "running" &&
          Date.parse(a.startedAt) <= input.now.getTime() &&
          Date.parse(a.startedAt) >= input.now.getTime() - 30 * 86400000,
      )
      .map((a) => (a.distanceMeters ?? 0) / 1000),
  );
  const longestPlanned = Math.max(
    ...reference.workouts.map((w) => workoutKm(w, reference.easyPace)),
  );
  if (longestRecent > 0 && longestPlanned > longestRecent * 1.1)
    return result(
      "hold",
      "The planned longest run is over 10% above the longest recorded run in 30 days. Review that session before building further.",
    );
  return result(
    "increase",
    "The completed week and recent check-ins support considering a small increase. Confirm the next week manually.",
    Math.round(Math.min(80, km! + Math.min(2, km! * 0.05)) * 10) / 10,
  );
}
