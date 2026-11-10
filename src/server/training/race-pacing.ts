import type Database from "better-sqlite3";
import type { ActivityMeasurement } from "../../shared/types/metrics";
import type { Commitments } from "../../shared/types/commitments";
import type { RunningTargets } from "../../shared/types/athlete";
import { RacePacingRepository } from "./race-pacing-repository";
import { racePacing } from "../../shared/race-pacing";
import { calendarDate, shiftDay } from "./dates";
import { weeklyMetrics, comparableRuns, sportGroup } from "./metrics";
import { pauseActive, pendingReturn } from "../../shared/commitment-calendar";
export function racePacingData(
  db: Database.Database,
  now: Date,
  activities: ActivityMeasurement[],
  commitments: Commitments,
  targets: RunningTargets,
) {
  const today = calendarDate(now),
    paceEvidence = new RacePacingRepository(db).all();
  const context = {
    runningKm:
      weeklyMetrics(activities, now)
        .filter((w) => !w.partial)
        .at(-1)?.runningKm ?? 0,
    longestKm: Math.max(
      0,
      ...activities
        .filter(
          (a) =>
            Date.parse(a.startedAt) <= now.getTime() &&
            sportGroup(a) === "running" &&
            calendarDate(new Date(a.startedAt)) >= shiftDay(today, -30),
        )
        .map((a) => (a.distanceMeters ?? 0) / 1000),
    ),
    matchedPairs: comparableRuns(activities, now, {
      min: targets.baseMin,
      max: targets.baseMax,
    }).pairs,
  };
  const racePaceAdvice = commitments.races
    .filter((r) => r.status !== "cancelled" && r.day >= today)
    .slice(0, 12)
    .map((r) => {
      const advice = racePacing(
        r,
        paceEvidence,
        today,
        commitments.races,
        context,
      );
      if (
        commitments.pauses.some(
          (p) => pauseActive(p, r.day) || pendingReturn(p, r.day),
        )
      ) {
        advice.status = "conflict";
        advice.range = null;
        advice.notes.unshift(
          "A training break or pending return review takes priority. No execution pace is recommended.",
        );
      }
      return advice;
    });
  return { paceEvidence, racePaceAdvice };
}
