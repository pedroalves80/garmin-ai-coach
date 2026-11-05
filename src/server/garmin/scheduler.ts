import { prepare } from "../db/statements";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { GarminRepository, SyncBusyError } from "../db/garmin-repository";
import { GarminHttpError, GarminNetworkError } from "./http";
import type { AutoSyncStatus } from "../../shared/types/sync";

export const SYNC_INTERVAL_MS = 3 * 60 * 60_000;
export const WORKER_LEASE_MS = 90_000;
const STARTUP_COOLDOWN_MS = 5 * 60_000;
type ScheduleRow = {
  next_run_at: string;
  last_attempt_at: string | null;
  last_seen_sync: string | null;
  failures: number;
  last_error: string | null;
  worker_owner: string | null;
  worker_expires_at: string | null;
  heartbeat_at: string | null;
};
function scheduleRow(db: Database.Database) {
  return prepare(
    db,
    "SELECT * FROM sync_schedule WHERE provider='garmin'",
  ).get() as ScheduleRow | undefined;
}
export function autoSyncStatus(
  db: Database.Database,
  enabled: boolean,
  now = new Date(),
): AutoSyncStatus {
  const row = scheduleRow(db);
  return {
    enabled,
    workerOnline:
      !!row?.worker_owner &&
      !!row.worker_expires_at &&
      Date.parse(row.worker_expires_at) > now.getTime(),
    nextRunAt: enabled ? (row?.next_run_at ?? null) : null,
    failures: row?.failures ?? 0,
    lastError: row?.last_error ?? null,
  };
}

export class GarminScheduler {
  private readonly owner = randomUUID();
  private inFlight = false;
  constructor(
    private db: Database.Database,
    private run: (signal: AbortSignal) => Promise<unknown>,
    private options: {
      enabled: boolean;
      configured: boolean;
      now?: () => Date;
    },
  ) {}
  private now() {
    return this.options.now?.() ?? new Date();
  }
  heartbeat() {
    const now = this.now(),
      iso = now.toISOString();
    return this.db
      .transaction(() => {
        const lastSync =
          new GarminRepository(this.db).status()?.lastCompletedAt ?? null;
        prepare(
          this.db,
          "INSERT OR IGNORE INTO sync_schedule(provider,next_run_at,last_seen_sync) VALUES('garmin',?,?)",
        ).run(iso, lastSync);
        const row = scheduleRow(this.db)!;
        if (
          row.worker_owner &&
          row.worker_owner !== this.owner &&
          row.worker_expires_at &&
          row.worker_expires_at > iso
        )
          return false;
        let next = row.next_run_at,
          failures = row.failures,
          error = row.last_error;
        if (row.worker_owner !== this.owner && failures === 0) {
          // Startup sync, with a persisted cooldown to avoid repeated restarts hammering Garmin.
          const earliest = new Date(
            Math.max(
              now.getTime(),
              Date.parse(row.last_attempt_at ?? "1970-01-01") +
                STARTUP_COOLDOWN_MS,
              Date.parse(lastSync ?? "1970-01-01") + STARTUP_COOLDOWN_MS,
            ),
          ).toISOString();
          next = earliest;
        }
        // A successful manual sync satisfies this interval and clears pending retries.
        if (lastSync && lastSync !== row.last_seen_sync) {
          next = new Date(
            Date.parse(lastSync) + SYNC_INTERVAL_MS,
          ).toISOString();
          failures = 0;
          error = null;
        }
        prepare(
          this.db,
          "UPDATE sync_schedule SET worker_owner=?,worker_expires_at=?,heartbeat_at=?,next_run_at=?,failures=?,last_error=?,last_seen_sync=? WHERE provider='garmin'",
        ).run(
          this.owner,
          new Date(now.getTime() + WORKER_LEASE_MS).toISOString(),
          iso,
          next,
          failures,
          error,
          lastSync,
        );
        return true;
      })
      .immediate();
  }
  release() {
    prepare(
      this.db,
      "UPDATE sync_schedule SET worker_owner=NULL,worker_expires_at=NULL,heartbeat_at=NULL WHERE provider='garmin' AND worker_owner=?",
    ).run(this.owner);
  }
  async tick(signal = new AbortController().signal) {
    if (
      this.inFlight ||
      signal.aborted ||
      !this.heartbeat() ||
      !this.options.enabled ||
      !this.options.configured
    )
      return "idle";
    const row = scheduleRow(this.db)!;
    if (row.next_run_at > this.now().toISOString()) return "idle";
    this.inFlight = true;
    prepare(
      this.db,
      "UPDATE sync_schedule SET last_attempt_at=? WHERE provider='garmin' AND worker_owner=?",
    ).run(this.now().toISOString(), this.owner);
    try {
      await this.run(signal);
      this.finish(SYNC_INTERVAL_MS, 0, null);
      return "synced";
    } catch (error) {
      if (error instanceof SyncBusyError || signal.aborted) {
        this.finish(60_000, row.failures, row.last_error);
        return "waiting";
      }
      const failures = Math.min(row.failures + 1, 100);
      const transient =
        error instanceof GarminNetworkError ||
        (error instanceof GarminHttpError &&
          (error.status === 429 || error.status >= 500)) ||
        (error instanceof DOMException && error.name === "TimeoutError");
      const delay =
        transient && failures <= 2
          ? (failures === 1 ? 5 : 15) * 60_000
          : SYNC_INTERVAL_MS;
      const message =
        error instanceof GarminHttpError || error instanceof GarminNetworkError
          ? error.message
          : "Automatic Garmin sync failed. Check the connection and retry manually if needed.";
      this.finish(delay, failures, message);
      return "failed";
    } finally {
      this.inFlight = false;
    }
  }
  private finish(delay: number, failures: number, error: string | null) {
    const lastSync =
      new GarminRepository(this.db).status()?.lastCompletedAt ?? null;
    prepare(
      this.db,
      "UPDATE sync_schedule SET next_run_at=?,failures=?,last_error=?,last_seen_sync=? WHERE provider='garmin' AND worker_owner=?",
    ).run(
      new Date(this.now().getTime() + delay).toISOString(),
      failures,
      error,
      lastSync,
      this.owner,
    );
  }
}
