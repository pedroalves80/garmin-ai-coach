import type Database from "better-sqlite3";
import { z } from "zod";
import {
  DEFAULT_ATHLETE,
  type AthleteProfile,
  type SessionEffort,
} from "../../shared/types/athlete";
export const runningTargetsSchema = z
  .object({
    baseMin: z.number().int().min(80).max(210),
    baseMax: z.number().int().min(80).max(210),
    recoveryMin: z.number().int().min(80).max(210),
    recoveryMax: z.number().int().min(80).max(210),
    longMin: z.number().int().min(80).max(210),
    longMax: z.number().int().min(80).max(210),
    strideMin: z.number().int().min(150).max(480),
    strideMax: z.number().int().min(150).max(480),
  })
  .strict()
  .refine(
    (t) =>
      t.baseMin < t.baseMax &&
      t.recoveryMin < t.recoveryMax &&
      t.longMin < t.longMax &&
      t.strideMin < t.strideMax &&
      t.recoveryMax <= t.baseMax,
    "Use ordered ranges and recovery intensity no higher than base.",
  );
export const athleteSchema = z
  .object({
    goal: z.literal("aerobic_running"),
    easyPace: z.number().int().min(240).max(600),
    tempoPace: z.number().int().min(180).max(420),
    targets: runningTargetsSchema,
    calibrationSource: z.enum([
      "provisional",
      "field_test",
      "lab_test",
      "coach_review",
    ]),
    reviewedAt: z.iso.date().nullable(),
    evidence: z.string().trim().max(300),
  })
  .strict()
  .refine(
    (p) =>
      p.calibrationSource === "provisional"
        ? p.reviewedAt === null
        : !!p.reviewedAt && p.evidence.length >= 5,
    "Reviewed targets need a date and a short explanation of the evidence.",
  );
export const effortSchema = z
  .object({
    activityId: z.string().min(1).max(150),
    rpe: z.number().int().min(1).max(10),
    prescriptionCompleted: z.boolean().default(false),
  })
  .strict();
export class AthleteRepository {
  constructor(private db: Database.Database) {}
  profile(): AthleteProfile {
    const row = this.db
      .prepare("SELECT profile_json FROM athlete_profile WHERE id=1")
      .get() as { profile_json: string } | undefined;
    return row
      ? athleteSchema.parse(JSON.parse(row.profile_json))
      : structuredClone(DEFAULT_ATHLETE);
  }
  saveProfile(profile: AthleteProfile) {
    this.db
      .prepare(
        "INSERT INTO athlete_profile(id,profile_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET profile_json=excluded.profile_json",
      )
      .run(JSON.stringify(athleteSchema.parse(profile)));
  }
  efforts(): SessionEffort[] {
    return (
      this.db
        .prepare(
          "SELECT activity_id AS activityId,rpe,prescription_completed AS prescriptionCompleted FROM session_efforts",
        )
        .all() as {
        activityId: string;
        rpe: number;
        prescriptionCompleted: number;
      }[]
    ).map((row) => ({
      ...row,
      prescriptionCompleted: !!row.prescriptionCompleted,
    }));
  }
  saveEffort(effort: SessionEffort) {
    const parsed = effortSchema.parse(effort);
    this.db
      .prepare(
        "INSERT INTO session_efforts(activity_id,rpe,prescription_completed,updated_at) VALUES(?,?,?,?) ON CONFLICT(activity_id) DO UPDATE SET rpe=excluded.rpe,prescription_completed=excluded.prescription_completed,updated_at=excluded.updated_at",
      )
      .run(
        parsed.activityId,
        parsed.rpe,
        parsed.prescriptionCompleted ? 1 : 0,
        new Date().toISOString(),
      );
  }
}
