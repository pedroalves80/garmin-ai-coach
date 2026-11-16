import type Database from "better-sqlite3";
import { z } from "zod";
import { prepare } from "../db/statements";
import { GarminRepository } from "../db/garmin-repository";
import { GarminClient } from "./client";
import { sportGroup } from "../training/metrics";
import { activityReviewFingerprint } from "../training/workout-reviews";
const value = z.number().finite().nonnegative().nullish();
const summarySchema = z.object({
  activityId: z.union([z.number(), z.string()]).optional(),
  splitSummaries: z
    .array(
      z
        .object({
          splitType: z.string().max(80),
          noOfSplits: z.number().int().min(0).max(10000).nullish(),
          distance: value,
          duration: value,
          averageHR: z.number().finite().min(0).max(300).nullish(),
          averageSpeed: value,
        })
        .transform((s) => ({
          splitType: s.splitType,
          noOfSplits: s.noOfSplits ?? null,
          distance: s.distance ?? null,
          duration: s.duration ?? null,
          averageHR: s.averageHR && s.averageHR > 0 ? s.averageHR : null,
          averageSpeed:
            s.averageSpeed && s.averageSpeed > 0 ? s.averageSpeed : null,
        })),
    )
    .max(1000)
    .optional(),
});
const workoutsSchema = z
  .array(
    z
      .object({
        sport: z.string().max(40).nullish(),
        steps: z.array(z.unknown()).max(1000).optional(),
      })
      .transform((w) => ({
        sport: w.sport ?? null,
        stepCount: w.steps?.length ?? 0,
      })),
  )
  .max(30);
export async function enrichActivityDetails(
  db: Database.Database,
  client: Pick<GarminClient, "activityDetail" | "activityWorkouts">,
  now = new Date(),
  signal?: AbortSignal,
) {
  const rows = new GarminRepository(db)
    .allActivities()
    .filter(
      (a) =>
        sportGroup(a) === "running" &&
        Date.parse(a.startedAt) <= now.getTime() &&
        Date.parse(a.startedAt) >= now.getTime() - 35 * 86400000,
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  let fetched = 0,
    unavailable = 0;
  for (const a of rows) {
    if (fetched >= 8 || signal?.aborted) break;
    const old = prepare(
      db,
      "SELECT activity_fingerprint,status,fetched_at,next_attempt_at FROM activity_details WHERE activity_id=?",
    ).get(a.id) as
      | {
          activity_fingerprint: string;
          status: string;
          fetched_at: string;
          next_attempt_at: string;
        }
      | undefined;
    const fingerprint = activityReviewFingerprint(a),
      stamp = now.toISOString();
    if (
      old &&
      old.activity_fingerprint === fingerprint &&
      old.next_attempt_at > stamp
    )
      continue;
    const claimed = db
      .transaction(() => {
        const pending = prepare(
          db,
          "SELECT status,next_attempt_at,activity_fingerprint FROM activity_details WHERE activity_id=?",
        ).get(a.id) as
          | {
              status: string;
              next_attempt_at: string;
              activity_fingerprint: string;
            }
          | undefined;
        if (
          pending &&
          pending.next_attempt_at > stamp &&
          (pending.status === "loading" ||
            pending.activity_fingerprint === fingerprint)
        )
          return false;
        prepare(
          db,
          "INSERT INTO activity_details(activity_id,activity_fingerprint,fetched_at,status,next_attempt_at) VALUES(?,?,?,'loading',?) ON CONFLICT(activity_id) DO UPDATE SET activity_fingerprint=excluded.activity_fingerprint,summary_json=NULL,workouts_json=NULL,status='loading',next_attempt_at=excluded.next_attempt_at",
        ).run(
          a.id,
          fingerprint,
          stamp,
          new Date(now.getTime() + 15 * 60000).toISOString(),
        );
        return true;
      })
      .immediate();
    if (!claimed) continue;
    fetched++;
    let summary: unknown = null,
      workouts: unknown = null;
    try {
      const raw = summarySchema.parse(
        await client.activityDetail(a.providerActivityId, signal),
      );
      if (
        raw.activityId !== undefined &&
        String(raw.activityId) !== String(a.providerActivityId)
      )
        throw new Error("Mismatched activity");
      summary = { splitSummaries: raw.splitSummaries ?? [] };
    } catch {
      unavailable++;
    }
    if (!signal?.aborted)
      try {
        workouts = workoutsSchema.parse(
          (await client.activityWorkouts(a.providerActivityId, signal)) ?? [],
        );
      } catch {
        unavailable++;
      }
    const status =
      summary !== null && workouts !== null
        ? "ready"
        : summary !== null || workouts !== null
          ? "partial"
          : "unavailable";
    const recent = now.getTime() - Date.parse(a.startedAt) < 2 * 86400000;
    const delay =
      status === "ready" ? (recent ? 6 * 3600000 : 365 * 86400000) : 86400000;
    prepare(
      db,
      "UPDATE activity_details SET summary_json=?,workouts_json=?,fetched_at=?,status=?,next_attempt_at=? WHERE activity_id=?",
    ).run(
      summary === null ? null : JSON.stringify(summary),
      workouts === null ? null : JSON.stringify(workouts),
      stamp,
      status,
      new Date(now.getTime() + delay).toISOString(),
      a.id,
    );
  }
  return { fetched, unavailable };
}
