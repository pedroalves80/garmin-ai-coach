import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { activities, syncState } from "@/server/db/schema";
import { fetchConfiguredGarminData } from "@/server/garmin/client";

function now() { return new Date().toISOString(); }
function listPayload(value: unknown): Record<string, unknown>[] { if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")); if (value && typeof value === "object" && "items" in value && Array.isArray(value.items)) return listPayload(value.items); return []; }
function stringValue(item: Record<string, unknown>, keys: string[]) { const key = keys.find((candidate) => item[candidate] !== undefined); return key === undefined || item[key] == null ? undefined : String(item[key]); }
function numberValue(item: Record<string, unknown>, keys: string[]) { const value = stringValue(item, keys); return value === undefined || Number.isNaN(Number(value)) ? undefined : Number(value); }

export async function syncGarminData() {
  const startedAt = now();
  db.insert(syncState).values({ provider: "garmin", lastStartedAt: startedAt, updatedAt: startedAt }).onConflictDoUpdate({ target: syncState.provider, set: { lastStartedAt: startedAt, lastError: null, updatedAt: startedAt } }).run();
  try {
    const data = await fetchConfiguredGarminData();
    const importedAt = now();
    for (const item of listPayload(data.activities)) {
      const providerActivityId = stringValue(item, ["activityId", "activity_id", "id"]);
      const started = stringValue(item, ["startTimeLocal", "startTimeGmt", "startTime", "startedAt"]);
      if (!providerActivityId || !started) continue;
      db.insert(activities).values({ id: `garmin:${providerActivityId}`, providerActivityId, sportType: stringValue(item, ["sportType", "activityType", "sport"]) ?? "unknown", name: stringValue(item, ["activityName", "name"]), startedAt: started, durationSeconds: numberValue(item, ["duration", "durationSeconds"]), distanceMeters: numberValue(item, ["distance", "distanceMeters"]), averageHeartRate: numberValue(item, ["averageHR", "avgHr", "averageHeartRate"]), maxHeartRate: numberValue(item, ["maxHR", "maxHr", "maxHeartRate"]), rawJson: JSON.stringify(item), importedAt }).onConflictDoUpdate({ target: activities.providerActivityId, set: { rawJson: JSON.stringify(item), importedAt } }).run();
    }
    const completedAt = now();
    db.update(syncState).set({ lastCompletedAt: completedAt, lastError: null, updatedAt: completedAt }).where(eq(syncState.provider, "garmin")).run();
    return { importedActivities: listPayload(data.activities).length, warnings: data.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Garmin sync error";
    db.update(syncState).set({ lastError: message, updatedAt: now() }).where(eq(syncState.provider, "garmin")).run();
    throw error;
  }
}
