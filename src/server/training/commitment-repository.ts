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
        this.db
          .prepare("SELECT item_json FROM race_events ORDER BY day")
          .all() as { item_json: string }[]
      ).map((r) => raceSchema.parse(JSON.parse(r.item_json))),
      pauses: (
        this.db
          .prepare("SELECT item_json FROM training_pauses ORDER BY start")
          .all() as { item_json: string }[]
      ).map((r) => pauseSchema.parse(JSON.parse(r.item_json))),
    };
  }
  saveRace(race: RaceEvent) {
    const parsed = raceSchema.parse(race);
    this.db
      .prepare(
        "INSERT INTO race_events(id,day,item_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day,item_json=excluded.item_json",
      )
      .run(parsed.id, parsed.day, JSON.stringify(parsed));
  }
  savePause(pause: TrainingPause) {
    const parsed = pauseSchema.parse(pause);
    this.db
      .prepare(
        "INSERT INTO training_pauses(id,start,item_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET start=excluded.start,item_json=excluded.item_json",
      )
      .run(parsed.id, parsed.start, JSON.stringify(parsed));
  }
  restDays() {
    return (
      this.db
        .prepare(
          "SELECT o.day,r.review_json FROM day_schedule_overrides o JOIN coach_reviews r ON r.id=o.review_id",
        )
        .all() as { day: string; review_json: string }[]
    )
      .filter((r) => JSON.parse(r.review_json).action === "rest")
      .map((r) => r.day);
  }
}
