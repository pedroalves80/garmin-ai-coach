import type { TrainingPlan } from "./types/metrics";
import type {
  TrainingPreferences,
  WeekPreferences,
  TrainingSession,
  CyclingWorkout,
  WeekSchedule,
  ScheduleChange,
  ScheduledDay,
} from "./types/schedule";
import { MAX_DAILY_WORKOUTS, WEEKDAY_LUNCH_MINUTES } from "./types/schedule";
import {
  stepSeconds,
  workoutKm,
  minimumRunKm,
  isDistanceWorkout,
} from "./training-plan";

export class ScheduleRuleError extends Error {}

export function dayOffsetDate(start: string, offset: number) {
  const date = new Date(`${start}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function cyclingWorkout(
  preferences: TrainingPreferences,
  effort: "recovery" | "endurance",
  minutes: number,
): CyclingWorkout {
  const duration = Math.max(15, Math.round(minutes));
  return {
    title: effort === "recovery" ? "Recovery cycling" : "Endurance cycling",
    effort,
    ftpWatts: preferences.ftpWatts,
    steps: [
      { name: "Warm Up", minutes: 5, minPercent: 40, maxPercent: 50 },
      {
        name: "Ride",
        minutes: duration - 10,
        minPercent: effort === "recovery" ? 45 : 56,
        maxPercent: effort === "recovery" ? 55 : 70,
      },
      { name: "Cool Down", minutes: 5, minPercent: 35, maxPercent: 45 },
    ],
  };
}
export function powerRange(ftp: number, min: number, max: number) {
  return {
    min: Math.ceil((ftp * min) / 100),
    max: Math.floor((ftp * max) / 100),
  };
}
export function cyclingMinutes(workout: CyclingWorkout) {
  return workout.steps.reduce((sum, s) => sum + s.minutes, 0);
}
export function cyclingWorkoutText(workout: CyclingWorkout) {
  return [
    workout.title,
    `FTP ${workout.ftpWatts} W`,
    ...workout.steps.map((step) => {
      const watts = powerRange(
        workout.ftpWatts,
        step.minPercent,
        step.maxPercent,
      );
      return `${step.name} — ${step.minutes} min — ${step.minPercent}–${step.maxPercent}% FTP (${watts.min}–${watts.max} W)`;
    }),
  ].join("\n");
}
export function validateRunningSchedule(plan: TrainingPlan) {
  const seen = new Set<number>();
  for (const run of plan.workouts) {
    if (run.dayOffset < 0 || run.dayOffset > 5 || seen.has(run.dayOffset))
      throw new ScheduleRuleError(
        "Running days must be distinct Monday–Saturday. Sunday is always rest.",
      );
    seen.add(run.dayOffset);
    if (
      workoutKm(run, plan.easyPace) < minimumRunKm - 1e-8 ||
      !isDistanceWorkout(run)
    )
      throw new ScheduleRuleError(
        "New runs need distance steps totaling at least 5 km.",
      );
    if (
      run.dayOffset < 5 &&
      run.steps.reduce((sum, s) => sum + stepSeconds(s, plan.easyPace), 0) >
        WEEKDAY_LUNCH_MINUTES * 60
    )
      throw new ScheduleRuleError(
        "A weekday run exceeds your two-hour lunch window. Review its distance or planning pace.",
      );
  }
}
export function validateDaySessions(
  dayOffset: number,
  sessions: TrainingSession[],
  easyPace: number,
) {
  if (dayOffset === 6 && sessions.length)
    throw new ScheduleRuleError("Sunday is always a rest day.");
  if (
    sessions.length > MAX_DAILY_WORKOUTS ||
    new Set(sessions.map((s) => s.slot)).size !== sessions.length
  )
    throw new ScheduleRuleError(
      "A day has at most one lunch session and one later session.",
    );
  if (new Set(sessions.map((s) => s.sport)).size !== sessions.length)
    throw new ScheduleRuleError(
      "Only one workout of each sport is planned per day.",
    );
  for (const session of sessions) {
    if (
      session.sport === "hyrox" &&
      (![0, 2, 4].includes(dayOffset) || session.slot !== "later")
    )
      throw new ScheduleRuleError(
        "Hyrox classes are Monday, Wednesday or Friday, later in the day.",
      );
    if (
      session.sport === "running" &&
      (session.slot !== "lunch" || session.workout.dayOffset !== dayOffset)
    )
      throw new ScheduleRuleError(
        "Runs use the lunch slot on their selected day.",
      );
    const minutes =
      session.sport === "running"
        ? session.workout.steps.reduce(
            (sum, s) => sum + stepSeconds(s, easyPace),
            0,
          ) / 60
        : session.sport === "cycling"
          ? cyclingMinutes(session.workout)
          : session.minutes;
    if (
      dayOffset < 5 &&
      session.slot === "lunch" &&
      minutes > WEEKDAY_LUNCH_MINUTES
    )
      throw new ScheduleRuleError(
        "Weekday lunch sessions are capped at two hours.",
      );
  }
}
export function buildWeekSchedule(
  plan: TrainingPlan,
  week: WeekPreferences,
  prefs: TrainingPreferences,
  changes: ScheduleChange[] = [],
  records: { day: string; sport: string; minutes: number; km: number }[] = [],
): WeekSchedule {
  return {
    start: plan.start,
    days: Array.from({ length: 7 }, (_, offset): ScheduledDay => {
      const day = dayOffsetDate(plan.start, offset),
        warnings: string[] = [];
      let sessions: TrainingSession[] = [];
      if (offset !== 6) {
        const run = plan.workouts.find((w) => w.dayOffset === offset);
        if (run)
          sessions.push({ sport: "running", slot: "lunch", workout: run });
        const attendance =
          offset === 0
            ? week.hyrox.monday
            : offset === 2
              ? week.hyrox.wednesday
              : offset === 4
                ? week.hyrox.friday
                : null;
        if (attendance && attendance !== "skipping")
          sessions.push({
            sport: "hyrox",
            slot: "later",
            minutes: 60,
            attendance,
          });
        else if (
          week.cyclingDays.includes(offset) ||
          (attendance === "skipping" && week.cycleWhenSkippingHyrox)
        )
          sessions.push({
            sport: "cycling",
            slot: "later",
            workout: cyclingWorkout(
              prefs,
              attendance === "skipping" ? "recovery" : "endurance",
              offset === 5
                ? prefs.saturdayCyclingMinutes
                : prefs.weekdayCyclingMinutes,
            ),
          });
        const override = changes.find((c) => c.day === day);
        if (override) sessions = override.sessions;
        validateDaySessions(offset, sessions, plan.easyPace);
      }
      const recorded = records
        .filter((r) => r.day === day)
        .map(({ sport, minutes, km }) => ({ sport, minutes, km }));
      const counts = new Map<string, number>();
      for (const record of recorded)
        counts.set(record.sport, (counts.get(record.sport) ?? 0) + 1);
      let available = Math.max(0, MAX_DAILY_WORKOUTS - recorded.length);
      const projected = sessions.map((session) => {
        const count = counts.get(session.sport) ?? 0;
        if (count > 0) {
          counts.set(session.sport, count - 1);
          return { session, status: "recorded" as const };
        }
        if (available > 0) {
          available--;
          return { session, status: "planned" as const };
        }
        warnings.push(
          "Two workouts are already recorded or allocated; review the remaining session.",
        );
        return { session, status: "blocked" as const };
      });
      if (offset === 6 && recorded.length)
        warnings.push(
          "Sunday remains unscheduled for recovery. Recorded activities are shown as history.",
        );
      return {
        day,
        dayOffset: offset,
        sessions: projected,
        recorded,
        warnings,
      };
    }),
  };
}
