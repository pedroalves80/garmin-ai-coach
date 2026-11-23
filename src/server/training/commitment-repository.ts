import { prepare } from "../db/statements";
import type Database from "better-sqlite3";
import { z } from "zod";
import type {
  Commitments,
  RaceEvent,
  TrainingPause,
} from "../../shared/types/commitments";
export const raceFields = z
  .object({
    name: z.string().trim().min(1).max(80),
    day: z.iso.date(),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    distanceKm: z.number().min(1).max(100).multipleOf(0.01),
    terrain: z.enum(["road", "trail"]),
    elevationGain: z.number().int().min(0).max(15000).nullable(),
    expectedMinutes: z.number().int().min(5).max(1440),
    priority: z.enum(["goal", "training"]),
  })
  .strict();
export const raceSchema = raceFields.extend({
  id: z.uuid(),
  status: z.enum(["planned", "completed", "cancelled"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  participationReview: z
    .object({
      previousId: z.uuid(),
      previousRevision: z.string().max(512),
      revision: z.string().max(512),
      reviewedAt: z.iso.datetime(),
    })
    .optional(),
  recoveryReview: z
    .object({
      revision: z.string().max(512),
      from: z.iso.date(),
      reviewedAt: z.iso.datetime(),
      activityId: z.string().max(100),
      recordingRevision: z.string().max(512),
    })
    .optional(),
  recorded: z
    .object({
      activityId: z.string().max(100),
      km: z.number().positive(),
      minutes: z.number().positive(),
    })
    .optional(),
});
export const pauseFields = z
  .object({
    start: z.iso.date(),
    end: z.iso.date().nullable(),
    reason: z.enum(["travel", "illness", "injury", "rest"]),
  })
  .strict()
  .refine((p) => !p.end || p.end >= p.start, "End must be on or after start.");
const pauseSchema = z.object({
  id: z.uuid(),
  start: z.iso.date(),
  end: z.iso.date().nullable(),
  reason: z.enum(["travel", "illness", "injury", "rest"]),
  cancelled: z.boolean(),
  resumeOn: z.iso.date().nullable(),
  returnReviewedAt: z.iso.date().nullable(),
  baselineReviewedAt: z.iso.date().nullable().default(null),
  staleWeeks: z.array(z.iso.date()).default([]),
  createdAt: z.iso.datetime(),
});
export class CommitmentRepository {
  constructor(private db: Database.Database) {}
  all(): Commitments {
    return {
      races: (
        prepare(
          this.db,
          "SELECT item_json FROM race_events ORDER BY day",
        ).all() as { item_json: string }[]
      ).map((r) => raceSchema.parse(JSON.parse(r.item_json))),
      pauses: (
        prepare(
          this.db,
          "SELECT item_json FROM training_pauses ORDER BY start",
        ).all() as { item_json: string }[]
      ).map((r) => pauseSchema.parse(JSON.parse(r.item_json))),
    };
  }
  saveRace(race: RaceEvent) {
    const inputs = { ...race };
    delete inputs.automaticRecovery;
    const parsed = raceSchema.parse(inputs);
    // Observations are derived from Garmin on read, never stored as race inputs.
    delete parsed.recorded;
    prepare(
      this.db,
      "INSERT INTO race_events(id,day,item_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day,item_json=excluded.item_json",
    ).run(parsed.id, parsed.day, JSON.stringify(parsed));
  }
  savePause(pause: TrainingPause) {
    const parsed = pauseSchema.parse(pause);
    prepare(
      this.db,
      "INSERT INTO training_pauses(id,start,item_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET start=excluded.start,item_json=excluded.item_json",
    ).run(parsed.id, parsed.start, JSON.stringify(parsed));
  }
  restDays() {
    return (
      prepare(
        this.db,
        "SELECT o.day,r.review_json FROM day_schedule_overrides o JOIN coach_reviews r ON r.id=o.review_id",
      ).all() as { day: string; review_json: string }[]
    )
      .filter((r) => JSON.parse(r.review_json).action === "rest")
      .map((r) => r.day);
  }
}
