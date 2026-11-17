import { milestoneForWeek } from "../../shared/milestones";
import { planningPolicy } from "./planning-policy";
import { observeRaces } from "./race-observations";
import {
  activeRaceSchedule,
  raceRevision,
  raceWindow,
} from "../../shared/race-policy";
import { raceRecoveryEvidence } from "./race-recovery";
import { AthleteRepository } from "./athlete-repository";
import { createTrainingPlan } from "../../shared/training-plan";
import { mondayOf } from "./dates";
import { sportGroup } from "./metrics";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CommitmentRepository,
  raceFields,
  pauseFields,
} from "./commitment-repository";
import { TrainingRepository } from "./repository";
import { GarminRepository } from "../db/garmin-repository";
import { calendarDate, shiftDay } from "./dates";
import {
  pauseActive,
  pendingReturn,
  daysBetween,
} from "../../shared/commitment-calendar";
export class CommitmentError extends Error {}
const idAction = <T extends string>(action: T) =>
  z.object({ action: z.literal(action), id: z.uuid() }).strict();
export const commitmentInput = z.union([
  z
    .object({
      action: z.literal("race"),
      id: z.uuid().optional(),
      race: raceFields,
    })
    .strict(),
  z.object({ action: z.literal("pause"), pause: pauseFields }).strict(),
  z
    .object({
      action: z.literal("review_race_participation"),
      id: z.uuid(),
      previousId: z.uuid(),
      revision: z.string().max(512),
      previousRevision: z.string().max(512),
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("review_race_recovery"),
      id: z.uuid(),
      revision: z.string().max(512),
      activityId: z.string().max(100),
      confirmed: z.literal(true),
    })
    .strict(),
  idAction("cancel_race"),
  idAction("complete_race"),
  idAction("cancel_pause"),
  idAction("resume"),
  idAction("review_return"),
  idAction("review_baseline"),
]);
export function returnReady(db: Database.Database, now: Date) {
  const today = calendarDate(now),
    checkIns = new TrainingRepository(db).checkIns(),
    check = checkIns.find((c) => c.day === today),
    sync = new GarminRepository(db).status()?.lastCompletedAt;
  return (
    !!check &&
    check.pain === 0 &&
    check.fatigue <= 2 &&
    check.soreness <= 2 &&
    !checkIns.some(
      (c) => c.day >= shiftDay(today, -2) && c.day <= today && c.pain > 0,
    ) &&
    !!sync &&
    Date.parse(sync) <= now.getTime() &&
    now.getTime() - Date.parse(sync) <= 2 * 86400000
  );
}
export function updateCommitment(
  db: Database.Database,
  input: unknown,
  now = new Date(),
) {
  const v = commitmentInput.parse(input),
    repo = new CommitmentRepository(db),
    today = calendarDate(now),
    stamp = now.toISOString();
  return db
    .transaction(() => {
      const c = observeRaces(
        repo.all(),
        new GarminRepository(db).allActivities(),
        now,
      );
      if (v.action === "race") {
        if (v.race.day < today || daysBetween(v.race.day, today) > 730)
          throw new CommitmentError(
            "Choose a race from today through the next two years.",
          );
        const old = v.id ? c.races.find((r) => r.id === v.id) : undefined;
        if (v.id && (!old || old.day < today || old.status !== "planned"))
          throw new CommitmentError(
            "Only upcoming planned races can be edited.",
          );
        if (
          c.races.some(
            (r) =>
              r.id !== v.id && r.day === v.race.day && r.status !== "cancelled",
          )
        )
          throw new CommitmentError(
            "There is already a race on this date. Edit that event instead.",
          );
        repo.saveRace({
          ...v.race,
          id: old?.id ?? randomUUID(),
          status: "planned",
          createdAt: old?.createdAt ?? stamp,
          updatedAt: stamp,
        });
      } else if (
        v.action === "review_race_participation" ||
        v.action === "review_race_recovery"
      ) {
        const r = c.races.find(
          (r) => r.id === v.id && r.status !== "cancelled",
        );
        if (!r || raceRevision(r) !== v.revision)
          throw new CommitmentError(
            "Event changed. Refresh and review its current details.",
          );
        if (
          c.pauses.some(
            (p) =>
              pauseActive(p, r.day) ||
              pendingReturn(p, r.day) ||
              pauseActive(p, today) ||
              pendingReturn(p, today),
          )
        )
          throw new CommitmentError(
            "A training break or return review takes priority.",
          );
        if (v.action === "review_race_participation") {
          const conflict = activeRaceSchedule(c.races).conflicts.find(
            (c) => c.race.id === r.id,
          );
          const previous = conflict?.previous;
          if (
            !previous ||
            previous.id !== v.previousId ||
            raceRevision(previous) !== v.previousRevision ||
            r.day < today ||
            r.status !== "planned" ||
            r.priority !== "training"
          )
            throw new CommitmentError(
              "Refresh the overlap; only an upcoming training event can be reviewed for controlled participation.",
            );
          if (
            raceWindow(previous).recovery > 3 ||
            raceWindow(r).recovery > 3 ||
            daysBetween(r.day, previous.day) <= raceWindow(previous).fullRest
          )
            throw new CommitmentError(
              "Initial rest and demanding-event recovery cannot be overridden here. Review the event dates or participation instead.",
            );
          if (r.day === today && raceRecoveryEvidence(db, now).reasons.length)
            throw new CommitmentError(
              "Current recovery concerns withhold controlled participation.",
            );
          repo.saveRace({
            ...r,
            participationReview: {
              previousId: previous.id,
              previousRevision: raceRevision(previous),
              revision: raceRevision(r),
              reviewedAt: stamp,
            },
            updatedAt: stamp,
          });
        } else {
          const sync = new GarminRepository(db).status()?.lastCompletedAt;
          if (
            !r.recorded ||
            r.recorded.activityId !== v.activityId ||
            !sync ||
            Date.parse(sync) > now.getTime() ||
            now.getTime() - Date.parse(sync) > 2 * 86400000
          )
            throw new CommitmentError(
              "Sync a matching race recording before reviewing your return to base running.",
            );
          const elapsed = daysBetween(today, r.day);
          if (
            elapsed <= raceWindow(r).fullRest ||
            elapsed > raceWindow(r).recovery ||
            r.distanceKm >= 42 ||
            r.recorded.minutes >= 240
          )
            throw new CommitmentError(
              "This review is available after initial rest within an ordinary event's recovery window. Major events retain their recovery safeguards.",
            );
          if (raceRecoveryEvidence(db, now).reasons.length)
            throw new CommitmentError(
              "Current recovery concerns need review before returning to base running.",
            );
          repo.saveRace({
            ...r,
            recoveryReview: {
              revision: raceRevision(r),
              from: today,
              reviewedAt: stamp,
              activityId: r.recorded.activityId,
              recordingRevision: JSON.stringify(r.recorded),
            },
            updatedAt: stamp,
          });
        }
      } else if (v.action === "pause") {
        if (
          v.pause.start < today ||
          daysBetween(v.pause.start, today) > 730 ||
          (v.pause.end && daysBetween(v.pause.end, today) > 730)
        )
          throw new CommitmentError(
            "Start the break today or within the next two years.",
          );
        if (
          c.pauses.some(
            (p) =>
              !p.cancelled &&
              (!p.resumeOn || !p.returnReviewedAt) &&
              (!v.pause.end || p.start <= v.pause.end) &&
              (!p.end || p.end >= v.pause.start),
          )
        )
          throw new CommitmentError(
            "This overlaps an existing break. End and review that break before adding another overlapping interval.",
          );
        repo.savePause({
          ...v.pause,
          id: randomUUID(),
          cancelled: false,
          resumeOn: null,
          returnReviewedAt: null,
          createdAt: stamp,
        });
      } else if (v.action === "cancel_race" || v.action === "complete_race") {
        const r = c.races.find((r) => r.id === v.id);
        if (!r) throw new CommitmentError("Race not found.");
        if (
          v.action === "cancel_race" &&
          (r.day < today || r.status === "completed")
        )
          throw new CommitmentError(
            "Keep past races in history; mark a completed race instead.",
          );
        if (v.action === "complete_race" && r.day > today)
          throw new CommitmentError("Future races cannot be marked completed.");
        repo.saveRace({
          ...r,
          status: v.action === "cancel_race" ? "cancelled" : "completed",
          updatedAt: stamp,
        });
      } else {
        const p = c.pauses.find((p) => p.id === v.id);
        if (!p || p.cancelled)
          throw new CommitmentError("Active break not found.");
        if (v.action === "cancel_pause") {
          if (p.start <= today)
            throw new CommitmentError(
              "A started break stays in history. Use End break instead.",
            );
          repo.savePause({ ...p, cancelled: true });
        } else if (v.action === "resume") {
          if (p.start > today || p.returnReviewedAt)
            throw new CommitmentError(
              "Only a started break awaiting return review can be ended.",
            );
          repo.savePause({ ...p, resumeOn: today });
        } else if (v.action === "review_baseline") {
          if (
            !p.returnReviewedAt ||
            p.baselineReviewedAt ||
            daysBetween(today, p.returnReviewedAt) < 7
          )
            throw new CommitmentError(
              "Complete at least seven days of the reduced return phase first.",
            );
          if (!returnReady(db, now))
            throw new CommitmentError(
              "Sync and log today's pain-free, low-fatigue check-in before reviewing a baseline.",
            );
          const recorded = new GarminRepository(db)
            .allActivities()
            .filter(
              (a) =>
                sportGroup(a) === "running" &&
                calendarDate(new Date(a.startedAt)) >= p.returnReviewedAt! &&
                calendarDate(new Date(a.startedAt)) >= shiftDay(today, -14) &&
                Date.parse(a.startedAt) <= now.getTime(),
            )
            .filter((a) => (a.distanceMeters ?? 0) >= 5000).length;
          if (recorded < 2)
            throw new CommitmentError(
              "Record at least two 5 km recovery runs during the return phase before reviewing the starting template. Longer illness or injury can need a longer individual return.",
            );
          const training = new TrainingRepository(db),
            monday = mondayOf(today),
            profile = new AthleteRepository(db).profile();
          const plan = createTrainingPlan(
            milestoneForWeek(monday, training.plans(), planningPolicy(db))
              .stage,
            monday,
            profile.easyPace,
            profile.tempoPace,
            20,
            {
              phase: "recovery",
              qualityLevel: 0,
              reason:
                "Explicitly reviewed 20 km recovery baseline after a break; old peaks are not restored automatically.",
              targets: profile.targets,
              reviewedAt: profile.reviewedAt,
            },
            planningPolicy(db),
          );
          training.savePlan(plan);
          for (const older of c.pauses.filter(
            (q) =>
              q.id !== p.id &&
              !q.cancelled &&
              q.returnReviewedAt &&
              !q.baselineReviewedAt,
          ))
            repo.savePause({ ...older, baselineReviewedAt: today });
          repo.savePause({
            ...p,
            baselineReviewedAt: today,
            staleWeeks: training
              .plans()
              .filter((plan) => plan.start > monday)
              .map((plan) => plan.start),
          });
        } else {
          if (!pendingReturn(p, today) || pauseActive(p, today))
            throw new CommitmentError(
              "End the break before reviewing your return.",
            );
          if (!returnReady(db, now))
            throw new CommitmentError(
              "Sync Garmin and log today's pain-free, low-fatigue recovery check-in. Recent pain also holds the return review.",
            );
          repo.savePause({ ...p, returnReviewedAt: today });
        }
      }
      return repo.all();
    })
    .immediate();
}
