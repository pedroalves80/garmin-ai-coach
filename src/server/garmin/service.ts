import { getGarminConfig } from "../config";
import { getDatabase } from "../db/client";
import { GarminRepository } from "../db/garmin-repository";
import { GarminClient } from "./client";
import { runGarminSync } from "./sync";

let cached: { key: string; client: GarminClient } | undefined;

export function syncGarminData(full = false, signal?: AbortSignal) {
  const config = getGarminConfig();
  const key = config.GARMIN_PERSONAL_API_KEY;
  if (!key)
    throw new Error(
      "Set GARMIN_PERSONAL_API_KEY in the server environment, then restart the app.",
    );
  if (!cached || cached.key !== key)
    cached = { key, client: new GarminClient(key) };
  return runGarminSync(new GarminRepository(getDatabase()), cached.client, {
    full,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)])
      : AbortSignal.timeout(5 * 60_000),
  });
}
