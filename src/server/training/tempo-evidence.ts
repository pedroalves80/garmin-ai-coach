import type Database from "better-sqlite3";
import { workoutReviews } from "./workout-reviews";
import { tempoWork } from "../../shared/tempo-progression";
import { calendarDate, shiftDay } from "./dates";
export type TempoObservation = {
  activityId: string;
  meters: number;
  min: number;
  max: number;
  aggregateSupported: boolean;
  adverse: boolean;
};
export function tempoEvidence(db: Database.Database, now = new Date()) {
  const reviews = workoutReviews(db, now).reviews;
  const observations: TempoObservation[] = [];
  for (const r of reviews) {
    if (
      !r.versionKnown ||
      !["automatic", "manual"].includes(r.match) ||
      !r.snapshot?.workout ||
      !["met", "over"].includes(r.distanceStatus) ||
      !r.plannedKm ||
      r.countedKm > r.plannedKm * 1.2
    )
      continue;
    const work = tempoWork(r.snapshot.workout);
    if (!work) continue;
    // A provider summary can support aggregate work only when its split count AND
    // distance isolate the tempo blocks. Mixed base/tempo summaries stay unknown.
    const row = db
      .prepare("SELECT summary_json FROM activity_details WHERE activity_id=?")
      .get(r.activityId) as { summary_json: string | null } | undefined;
    const groups =
      ["ready", "partial"].includes(r.detailStatus) && row?.summary_json
        ? ((JSON.parse(row.summary_json).splitSummaries ?? []) as {
            splitType: string;
            noOfSplits: number | null;
            distance: number | null;
            averageSpeed: number | null;
          }[])
        : [];
    const active = groups.filter((g) => g.splitType === "INTERVAL_ACTIVE");
    const isolated =
      active.length === 1 &&
      active[0].distance !== null &&
      Math.abs(active[0].distance - work.meters) <=
        Math.max(30, work.meters * 0.05);
    const pace =
      isolated && active[0].averageSpeed && active[0].averageSpeed > 0
        ? 1000 / active[0].averageSpeed
        : null;
    const repeat = r.snapshot.workout.steps.find((s) => s.kind === "repeat");
    const supported =
      !!isolated &&
      repeat?.kind === "repeat" &&
      active[0].noOfSplits === repeat.times &&
      pace !== null;
    observations.push({
      activityId: r.activityId,
      ...work,
      aggregateSupported: supported && pace >= work.min && pace <= work.max,
      adverse: supported && (pace < work.min || pace > work.max),
    });
  }
  return {
    adverseRecently: observations.some(
      (o) =>
        o.adverse &&
        reviews.some(
          (r) =>
            r.activityId === o.activityId &&
            r.day >= shiftDay(calendarDate(now), -7),
        ),
    ),
    observations,
    harderRecently: reviews.some(
      (r) => r.day >= shiftDay(calendarDate(now), -7) && r.feeling === "harder",
    ),
  };
}
