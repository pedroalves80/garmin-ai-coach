import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prepare } from "../db/statements";
import { calendarDate } from "./dates";
import { daysBetween } from "../../shared/commitment-calendar";
import type { RacePaceEvidence } from "../../shared/types/race-pacing";
export const paceEvidenceSchema = z
  .object({
    day: z.iso.date(),
    source: z.enum(["garmin_prediction", "road_race", "road_test"]),
    distanceKm: z.number().min(3).max(21.1).multipleOf(0.01),
    seconds: z.number().int().min(300).max(21600),
    confirmed: z.literal(true),
  })
  .strict()
  .refine(
    (v) => v.seconds / v.distanceKm >= 150 && v.seconds / v.distanceKm <= 900,
    "Use a plausible whole-course road performance, excluding warm-up and cool-down.",
  );
export class RacePacingRepository {
  constructor(private db: Database.Database) {}
  all() {
    return prepare(
      this.db,
      "SELECT id,day,source,distance_km AS distanceKm,seconds,updated_at AS updatedAt FROM race_pace_evidence ORDER BY day DESC,updated_at DESC LIMIT 50",
    ).all() as RacePaceEvidence[];
  }
  save(input: unknown, now = new Date()) {
    const v = paceEvidenceSchema.parse(input),
      today = calendarDate(now);
    if (v.day > today || daysBetween(today, v.day) > 90)
      throw new Error(
        "Choose evidence from the last 90 days, not a future target.",
      );
    prepare(
      this.db,
      "INSERT INTO race_pace_evidence(id,day,source,distance_km,seconds,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(day,source,distance_km) DO UPDATE SET seconds=excluded.seconds,updated_at=excluded.updated_at",
    ).run(
      randomUUID(),
      v.day,
      v.source,
      v.distanceKm,
      v.seconds,
      now.toISOString(),
    );
  }
}
