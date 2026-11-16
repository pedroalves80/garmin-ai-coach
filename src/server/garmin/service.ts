import {
  captureExistingPrescriptions,
  captureUpcomingWorkouts,
} from "../training/review-capture";
import { enrichActivityDetails } from "./activity-details";
import { getGarminConfig } from "../config";
import { getDatabase } from "../db/client";
import { GarminRepository } from "../db/garmin-repository";
import { GarminClient } from "./client";
import { runGarminSync } from "./sync";

let cached: { key: string; client: GarminClient } | undefined;

export async function syncGarminData(full = false, signal?: AbortSignal) {
  const config = getGarminConfig();
  const key = config.GARMIN_PERSONAL_API_KEY;
  if (!key)
    throw new Error(
      "Set GARMIN_PERSONAL_API_KEY in the server environment, then restart the app.",
    );
  if (!cached || cached.key !== key)
    cached = { key, client: new GarminClient(key) };
  const db = getDatabase(),
    now = new Date(),
    combined = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)])
      : AbortSignal.timeout(5 * 60_000);
  captureExistingPrescriptions(db, now);
  captureUpcomingWorkouts(db, now);
  const result = await runGarminSync(new GarminRepository(db), cached.client, {
    full,
    signal: combined,
  });
  // Detail availability cannot roll back an otherwise successful core health/activity sync.
  const details = await enrichActivityDetails(
    db,
    cached.client,
    new Date(),
    combined,
  ).catch(() => ({ fetched: 0, unavailable: 1 }));
  captureUpcomingWorkouts(db, new Date());
  return { ...result, reviewDetails: details };
}
