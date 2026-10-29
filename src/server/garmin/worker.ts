import Database from "better-sqlite3";
import { getConfig } from "../config";
import { getDatabase } from "../db/client";
import { GarminScheduler, autoSyncStatus } from "./scheduler";
import { syncGarminData } from "./service";

async function main() {
  const config = getConfig();
  if (process.argv.includes("--healthcheck")) {
    const db = new Database(config.DATABASE_PATH, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      process.exitCode = autoSyncStatus(db, config.GARMIN_AUTO_SYNC)
        .workerOnline
        ? 0
        : 1;
    } finally {
      db.close();
    }
    return;
  }
  const db = getDatabase(),
    controller = new AbortController();
  const scheduler = new GarminScheduler(
    db,
    (signal) => syncGarminData(false, signal),
    {
      enabled: config.GARMIN_AUTO_SYNC,
      configured: !!config.GARMIN_PERSONAL_API_KEY,
    },
  );
  let pending: Promise<void> | null = null,
    stopping = false;
  const tick = () => {
    if (pending || stopping) return;
    pending = scheduler
      .tick(controller.signal)
      .then((result) => {
        if (result === "synced")
          console.info("Automatic Garmin sync completed.");
        if (result === "failed")
          console.warn(
            "Automatic Garmin sync failed; the next attempt is scheduled. See the Garmin panel.",
          );
      })
      .catch(() => {
        console.error(
          "Garmin scheduler stopped unexpectedly. Check database availability.",
        );
        setImmediate(() => void stop(1));
      })
      .finally(() => {
        pending = null;
      });
  };
  const timer = setInterval(tick, 30_000);
  const heartbeat = setInterval(() => {
    try {
      scheduler.heartbeat();
    } catch {
      console.error("Garmin worker heartbeat failed.");
      void stop(1);
    }
  }, 20_000);
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    clearInterval(heartbeat);
    controller.abort();
    await pending;
    try {
      scheduler.release();
    } finally {
      db.close();
      process.exitCode = code;
    }
  }
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  console.info(
    config.GARMIN_AUTO_SYNC
      ? "Garmin worker started: startup sync and every three hours."
      : "Garmin worker started: automatic syncing disabled.",
  );
  tick();
}
void main().catch(() => {
  console.error(
    "Garmin worker could not start. Check its configuration and persistent storage.",
  );
  process.exitCode = 1;
});
