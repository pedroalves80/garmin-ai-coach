import type { ActivityMeasurement } from "../../shared/types/metrics";
import type { SessionEffort } from "../../shared/types/athlete";
import { calendarDate, mondayOf, shiftDay } from "./dates";
import { sportGroup } from "./metrics";

export function measuredLoad(
  activities: ActivityMeasurement[],
  efforts: SessionEffort[],
  now: Date,
) {
  const ratings = new Map(efforts.map((e) => [e.activityId, e.rpe]));
  const monday = mondayOf(calendarDate(now));
  return Array.from({ length: 5 }, (_, i) => {
    const start = shiftDay(monday, (i - 4) * 7),
      end = shiftDay(start, 7);
    const rows = activities.filter(
      (a) =>
        Date.parse(a.startedAt) <= now.getTime() &&
        calendarDate(new Date(a.startedAt)) >= start &&
        calendarDate(new Date(a.startedAt)) < end &&
        sportGroup(a) !== "wellness",
    );
    let totalMinutes = 0,
      ratedMinutes = 0,
      measuredAu = 0,
      unknownSessions = 0;
    const hardDays = new Set<string>();
    for (const row of rows) {
      const duration = (row.durationSeconds ?? 0) / 60,
        rpe = ratings.get(row.id);
      totalMinutes += duration;
      if (rpe !== undefined && duration > 0) {
        ratedMinutes += duration;
        measuredAu += duration * rpe;
        if (rpe >= 6) hardDays.add(calendarDate(new Date(row.startedAt)));
      } else unknownSessions++;
    }
    return {
      start,
      partial: i === 4,
      sessions: rows.length,
      totalMinutes: Math.round(totalMinutes),
      measuredAu: Math.round(measuredAu),
      coverage: totalMinutes > 0 ? ratedMinutes / totalMinutes : 0,
      unknownSessions,
      hardDays: hardDays.size,
    };
  });
}
export type LoadWeek = ReturnType<typeof measuredLoad>[number];
export function combinedLoadReview(weeks: LoadWeek[]) {
  const complete = weeks.filter((w) => !w.partial),
    latest = complete.at(-1)!;
  const baseline = complete
    .slice(0, -1)
    .filter(
      (w) => w.sessions > 0 && w.coverage >= 0.8 && w.unknownSessions === 0,
    );
  const baselineAu = baseline.length
    ? baseline.reduce((n, w) => n + w.measuredAu, 0) / baseline.length
    : null;
  const change =
    baselineAu && latest.coverage >= 0.8
      ? latest.measuredAu / baselineAu - 1
      : null;
  const reasons: string[] = [];
  if (!baseline.length)
    reasons.push(
      "Rate at least two completed training weeks to establish combined-effort context before increasing.",
    );
  if (latest.sessions === 0)
    reasons.push("No training sessions recorded in the last completed week.");
  if (latest.unknownSessions > 0 || latest.coverage < 0.8)
    reasons.push(
      "Log session effort for the completed week; missing effort or duration is unknown load.",
    );
  if (latest.hardDays > 3)
    reasons.push(
      "More than three demanding training days were recorded across all sports.",
    );
  if (change !== null && change > 0.15)
    reasons.push(
      "Measured combined effort rose over 15% versus recent rated weeks. Consolidate before adding running load.",
    );
  return {
    weeks,
    latest,
    baselineAu,
    baselineWeeks: baseline.length,
    change,
    reasons,
    cleared: reasons.length === 0,
  };
}
