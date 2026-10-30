import type { TrainingPlan } from "./types/metrics";
import type { WeekSchedule, TrainingSession } from "./types/schedule";
import { stepSeconds } from "./training-plan";
import { cyclingMinutes } from "./weekly-schedule";
export function plannedEffort(session: TrainingSession) {
  return session.sport === "hyrox"
    ? 7
    : session.sport === "cycling"
      ? session.workout.effort === "recovery"
        ? 2
        : 3
      : session.workout.type === "quality"
        ? 6
        : session.workout.type === "long" || session.workout.type === "strides"
          ? 3
          : 2;
}
export function plannedMinutes(session: TrainingSession, plan: TrainingPlan) {
  return session.sport === "hyrox"
    ? session.minutes
    : session.sport === "cycling"
      ? cyclingMinutes(session.workout)
      : session.workout.steps.reduce(
          (n, s) => n + stepSeconds(s, plan.easyPace),
          0,
        ) / 60;
}
export function reviewPlannedWeek(
  calendar: WeekSchedule,
  plan: TrainingPlan,
  load: {
    latest: { coverage: number; sessions: number; measuredAu: number };
    baselineAu: number | null;
  },
) {
  const days = calendar.days.map((d) => ({
    day: d.day,
    dayOffset: d.dayOffset,
    au: Math.round(
      d.sessions.reduce(
        (n, s) =>
          n + plannedMinutes(s.session, plan) * plannedEffort(s.session),
        0,
      ),
    ),
    hard: d.sessions.some((s) => plannedEffort(s.session) >= 6),
    keyRun: d.sessions.some(
      (s) =>
        s.session.sport === "running" &&
        ["quality", "long"].includes(s.session.workout.type),
    ),
    secondary: d.sessions.some((s) => s.session.sport !== "running"),
    hardSecondary: d.sessions.some(
      (s) => s.session.sport !== "running" && plannedEffort(s.session) >= 6,
    ),
    qualityRun: d.sessions.some(
      (s) =>
        s.session.sport === "running" && s.session.workout.type === "quality",
    ),
    minutes: d.sessions.reduce(
      (n, s) => n + plannedMinutes(s.session, plan),
      0,
    ),
  }));
  const warnings: string[] = [];
  const suggestedSkips: number[] = [];
  for (const day of days) {
    const next = days[day.dayOffset + 1];
    if (day.hardSecondary && next?.keyRun) {
      warnings.push(
        `${day.day}: a demanding secondary session precedes a key run. Skip or scale that session to protect running recovery.`,
      );
      suggestedSkips.push(day.dayOffset);
    }
    if (day.qualityRun && next?.keyRun)
      warnings.push(
        `${day.day}: quality running precedes another key run. Move one session or reduce its demands before progressing.`,
      );
    if (day.hardSecondary && day.keyRun) {
      warnings.push(
        `${day.day}: demanding Hyrox and a key run share the day. Keep running first; remove or scale the class.`,
      );
      suggestedSkips.push(day.dayOffset);
    }
    if (day.keyRun && day.secondary && day.minutes > 180) {
      warnings.push(
        `${day.day}: more than three hours are planned around a key run. Review the supporting session and recovery.`,
      );
      suggestedSkips.push(day.dayOffset);
    }
  }
  const au = days.reduce((n, d) => n + d.au, 0),
    hardDays = days.filter((d) => d.hard).length;
  if (hardDays > 3)
    warnings.push(
      "This week has more than three demanding days across all sports. Remove secondary intensity before adding more running quality.",
    );
  const baseline =
    load.latest.coverage >= 0.8 && load.latest.sessions > 0
      ? Math.max(load.latest.measuredAu, load.baselineAu ?? 0)
      : load.baselineAu;
  if (baseline && au > baseline * 1.15)
    warnings.push(
      "Estimated weekly effort is more than 15% above the recent measured reference. Review supporting sessions and running progression.",
    );
  return {
    estimatedAu: au,
    hardDays,
    days,
    warnings,
    suggestedSkips,
    baselineAu: baseline,
  };
}
