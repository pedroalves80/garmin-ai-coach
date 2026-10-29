import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { desc, eq } from "drizzle-orm";
import { activities, dailyHealth, syncState } from "./schema";
import type {
  GarminActivity,
  GarminHealth,
  GarminSleep,
} from "../garmin/schemas";

export class SyncBusyError extends Error {
  constructor() {
    super("A Garmin sync is already running. Wait for it to finish.");
  }
}

export class GarminRepository {
  readonly db;
  constructor(private readonly sqlite: Database.Database) {
    this.db = drizzle(sqlite);
  }

  status() {
    return (
      this.db
        .select()
        .from(syncState)
        .where(eq(syncState.provider, "garmin"))
        .get() ?? null
    );
  }
  recentActivities() {
    return this.db
      .select()
      .from(activities)
      .orderBy(desc(activities.startedAt))
      .limit(10)
      .all();
  }
  allActivities() {
    return this.db.select().from(activities).all();
  }
  latestHealth() {
    return (
      this.db
        .select()
        .from(dailyHealth)
        .orderBy(desc(dailyHealth.day))
        .limit(1)
        .get() ?? null
    );
  }

  acquire(now: Date): string {
    const owner = randomUUID();
    this.sqlite
      .transaction(() => {
        this.sqlite
          .prepare(
            "DELETE FROM sync_lock WHERE provider = 'garmin' AND expires_at < ?",
          )
          .run(now.toISOString());
        const result = this.sqlite
          .prepare(
            "INSERT OR IGNORE INTO sync_lock(provider, owner, expires_at) VALUES ('garmin', ?, ?)",
          )
          .run(owner, new Date(now.getTime() + 10 * 60_000).toISOString());
        if (!result.changes) throw new SyncBusyError();
        this.db
          .insert(syncState)
          .values({
            provider: "garmin",
            lastStartedAt: now.toISOString(),
            updatedAt: now.toISOString(),
          })
          .onConflictDoUpdate({
            target: syncState.provider,
            set: {
              lastStartedAt: now.toISOString(),
              lastError: null,
              updatedAt: now.toISOString(),
            },
          })
          .run();
      })
      .immediate();
    return owner;
  }

  release(owner: string) {
    this.sqlite
      .prepare("DELETE FROM sync_lock WHERE provider = 'garmin' AND owner = ?")
      .run(owner);
  }
  isRunning() {
    return Boolean(
      this.sqlite
        .prepare(
          "SELECT 1 FROM sync_lock WHERE provider = 'garmin' AND expires_at >= ?",
        )
        .get(new Date().toISOString()),
    );
  }

  fail(message: string, now: Date) {
    this.db
      .update(syncState)
      .set({ lastError: message, updatedAt: now.toISOString() })
      .where(eq(syncState.provider, "garmin"))
      .run();
  }

  commit(
    batch: {
      activities: GarminActivity[];
      health: GarminHealth[];
      sleep: GarminSleep[];
    },
    now: Date,
    owner: string,
  ) {
    this.sqlite
      .transaction(() => {
        const lock = this.sqlite
          .prepare("SELECT owner FROM sync_lock WHERE provider = 'garmin'")
          .get() as { owner: string } | undefined;
        if (lock?.owner !== owner) throw new SyncBusyError();
        const importedAt = now.toISOString();
        for (const item of batch.activities) {
          const providerActivityId = String(item.activityId);
          const values = {
            id: `garmin:${providerActivityId}`,
            providerActivityId,
            sportType: item.activityType.typeKey,
            name: item.activityName ?? null,
            startedAt: item.startTimeGMT,
            distanceMeters: item.distance ?? null,
            durationSeconds: item.duration ?? null,
            averageHeartRate: item.averageHR ?? null,
            maxHeartRate: item.maxHR ?? null,
            rawJson: JSON.stringify(item),
            importedAt,
          };
          this.db
            .insert(activities)
            .values(values)
            .onConflictDoUpdate({
              target: activities.providerActivityId,
              set: values,
            })
            .run();
        }
        const healthByDay = new Map(
          batch.health.map((item) => [item.calendarDate, item]),
        );
        const sleepByDay = new Map(
          batch.sleep.map((item) => [item.calendarDate, item]),
        );
        for (const day of new Set([
          ...healthByDay.keys(),
          ...sleepByDay.keys(),
        ])) {
          const health = healthByDay.get(day);
          const sleep = sleepByDay.get(day);
          const existing = this.db
            .select()
            .from(dailyHealth)
            .where(eq(dailyHealth.day, day))
            .get();
          const raw = existing ? JSON.parse(existing.rawJson) : {};
          const values = {
            id: `garmin:${day}`,
            day,
            sleepSeconds: sleep
              ? (sleep.sleepTimeSeconds ?? null)
              : (existing?.sleepSeconds ?? null),
            restingHeartRate: health
              ? (health.heartRate?.restingValue ?? null)
              : (existing?.restingHeartRate ?? null),
            bodyBattery: health
              ? (health.bodyBattery?.latestValue ?? null)
              : (existing?.bodyBattery ?? null),
            rawJson: JSON.stringify({
              ...raw,
              ...(health ? { health } : {}),
              ...(sleep ? { sleep } : {}),
            }),
            importedAt,
          };
          this.db
            .insert(dailyHealth)
            .values(values)
            .onConflictDoUpdate({ target: dailyHealth.day, set: values })
            .run();
        }
        this.db
          .update(syncState)
          .set({
            lastCompletedAt: importedAt,
            lastError: null,
            updatedAt: importedAt,
          })
          .where(eq(syncState.provider, "garmin"))
          .run();
      })
      .immediate();
  }
}
