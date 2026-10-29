import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/server/db/migrate";
import {
  GarminRepository,
  SyncBusyError,
} from "../src/server/db/garmin-repository";
import {
  GarminScheduler,
  autoSyncStatus,
  SYNC_INTERVAL_MS,
  WORKER_LEASE_MS,
} from "../src/server/garmin/scheduler";
import {
  GarminHttpError,
  GarminNetworkError,
  requestJson,
} from "../src/server/garmin/http";
import { runGarminSync } from "../src/server/garmin/sync";

function fixture() {
  const db = new Database(":memory:");
  migrateDatabase(db);
  let clock = new Date("2026-10-29T12:00:00Z");
  const now = () => clock;
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  const repository = new GarminRepository(db);
  const commit = () => {
    const owner = repository.acquire(now());
    repository.commit({ activities: [], health: [], sleep: [] }, now(), owner);
    repository.release(owner);
  };
  return { db, now, advance, commit, repository };
}
function row(db: Database.Database) {
  return db
    .prepare(
      "SELECT next_run_at,failures,last_attempt_at FROM sync_schedule WHERE provider='garmin'",
    )
    .get() as {
    next_run_at: string;
    failures: number;
    last_attempt_at: string | null;
  };
}

test("automatic sync runs at startup then every three hours, including after a long downtime", async () => {
  const f = fixture();
  let calls = 0;
  const scheduler = new GarminScheduler(
    f.db,
    async () => {
      calls++;
      f.commit();
    },
    { enabled: true, configured: true, now: f.now },
  );
  assert.equal(await scheduler.tick(), "synced");
  assert.equal(calls, 1);
  assert.equal(
    row(f.db).next_run_at,
    new Date(f.now().getTime() + SYNC_INTERVAL_MS).toISOString(),
  );
  f.advance(SYNC_INTERVAL_MS - 1);
  assert.equal(await scheduler.tick(), "idle");
  assert.equal(calls, 1);
  f.advance(1);
  assert.equal(await scheduler.tick(), "synced");
  assert.equal(calls, 2);
  scheduler.release();
  f.advance(24 * 60 * 60_000);
  const restarted = new GarminScheduler(
    f.db,
    async () => {
      calls++;
      f.commit();
    },
    { enabled: true, configured: true, now: f.now },
  );
  assert.equal(await restarted.tick(), "synced");
  assert.equal(calls, 3);
  f.db.close();
});

test("startup cooldown survives quick restarts; a later startup sync runs ahead of the next interval", async () => {
  const f = fixture();
  let calls = 0;
  const create = () =>
    new GarminScheduler(
      f.db,
      async () => {
        calls++;
        f.commit();
      },
      { enabled: true, configured: true, now: f.now },
    );
  const first = create();
  await first.tick();
  first.release();
  f.advance(60_000);
  const second = create();
  assert.equal(await second.tick(), "idle");
  assert.equal(calls, 1);
  assert.equal(row(f.db).next_run_at, "2026-10-29T12:05:00.000Z");
  f.advance(4 * 60_000);
  await second.tick();
  assert.equal(calls, 2);
  second.release();
  f.advance(10 * 60_000);
  const third = create();
  assert.equal(await third.tick(), "synced");
  assert.equal(calls, 3);
  f.db.close();
});

test("persisted retry timing is 5 minutes, 15 minutes then 3 hours and restarts do not reset it", async () => {
  const f = fixture();
  let calls = 0;
  const create = () =>
    new GarminScheduler(
      f.db,
      async () => {
        calls++;
        throw new GarminNetworkError();
      },
      { enabled: true, configured: true, now: f.now },
    );
  const first = create();
  assert.equal(await first.tick(), "failed");
  first.release();
  assert.equal(row(f.db).next_run_at, "2026-10-29T12:05:00.000Z");
  f.advance(60_000);
  const second = create();
  assert.equal(await second.tick(), "idle");
  assert.equal(calls, 1);
  f.advance(4 * 60_000);
  assert.equal(await second.tick(), "failed");
  assert.equal(row(f.db).next_run_at, "2026-10-29T12:20:00.000Z");
  f.advance(15 * 60_000);
  assert.equal(await second.tick(), "failed");
  assert.equal(row(f.db).next_run_at, "2026-10-29T15:20:00.000Z");
  assert.equal(row(f.db).failures, 3);
  f.db.close();
});

test("HTTP 429/5xx retry soon, while credentials and malformed responses wait for the normal interval", async () => {
  for (const error of [
    new GarminHttpError(429),
    new GarminHttpError(503),
    new GarminHttpError(401),
    new GarminHttpError(403),
    new Error("PRIVATE upstream payload"),
  ]) {
    const f = fixture();
    const scheduler = new GarminScheduler(
      f.db,
      async () => {
        throw error;
      },
      { enabled: true, configured: true, now: f.now },
    );
    await scheduler.tick();
    const status = autoSyncStatus(f.db, true, f.now());
    const transient = error instanceof GarminHttpError && error.status >= 429;
    assert.equal(
      Date.parse(status.nextRunAt!) - f.now().getTime(),
      transient ? 5 * 60_000 : SYNC_INTERVAL_MS,
    );
    assert(!status.lastError?.includes("PRIVATE"));
    f.db.close();
  }
});

test("a successful manual sync cancels scheduled retries and rebases the next interval", async () => {
  const f = fixture();
  let calls = 0;
  const scheduler = new GarminScheduler(
    f.db,
    async () => {
      calls++;
      throw new GarminNetworkError();
    },
    { enabled: true, configured: true, now: f.now },
  );
  await scheduler.tick();
  f.advance(2 * 60_000);
  f.commit();
  assert.equal(await scheduler.tick(), "idle");
  assert.equal(calls, 1);
  assert.equal(autoSyncStatus(f.db, true, f.now()).lastError, null);
  assert.equal(row(f.db).failures, 0);
  assert.equal(
    Date.parse(row(f.db).next_run_at) - f.now().getTime(),
    SYNC_INTERVAL_MS,
  );
  f.db.close();
});

test("manual sync overlap does not count as failure and is rechecked after one minute", async () => {
  const f = fixture();
  const scheduler = new GarminScheduler(
    f.db,
    async () => {
      throw new SyncBusyError();
    },
    { enabled: true, configured: true, now: f.now },
  );
  assert.equal(await scheduler.tick(), "waiting");
  assert.equal(row(f.db).failures, 0);
  assert.equal(Date.parse(row(f.db).next_run_at) - f.now().getTime(), 60_000);
  f.db.close();
});

test("two workers and repeated ticks cannot start overlapping jobs; heartbeat stays alive during a run", async () => {
  const f = fixture();
  let calls = 0,
    finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const first = new GarminScheduler(
    f.db,
    async () => {
      calls++;
      await wait;
      f.commit();
    },
    { enabled: true, configured: true, now: f.now },
  );
  const second = new GarminScheduler(
    f.db,
    async () => {
      calls++;
    },
    { enabled: true, configured: true, now: f.now },
  );
  const active = first.tick();
  assert.equal(await first.tick(), "idle");
  assert.equal(await second.tick(), "idle");
  assert.equal(calls, 1);
  f.advance(WORKER_LEASE_MS - 1);
  first.heartbeat();
  f.advance(2000);
  assert.equal(autoSyncStatus(f.db, true, f.now()).workerOnline, true);
  assert.equal(await second.tick(), "idle");
  finish();
  await active;
  f.db.close();
});

test("crashed worker leases expire; a previous worker cannot release the new leader", async () => {
  const f = fixture();
  const first = new GarminScheduler(f.db, async () => {}, {
    enabled: true,
    configured: true,
    now: f.now,
  });
  first.heartbeat();
  f.advance(WORKER_LEASE_MS + 1);
  assert.equal(autoSyncStatus(f.db, true, f.now()).workerOnline, false);
  const second = new GarminScheduler(
    f.db,
    async () => {
      f.commit();
    },
    { enabled: true, configured: true, now: f.now },
  );
  assert.equal(await second.tick(), "synced");
  first.release();
  assert.equal(autoSyncStatus(f.db, true, f.now()).workerOnline, true);
  f.db.close();
});

test("disabled or unconfigured workers remain healthy without contacting Garmin", async () => {
  for (const options of [
    { enabled: false, configured: true },
    { enabled: true, configured: false },
  ]) {
    const f = fixture();
    let calls = 0;
    const worker = new GarminScheduler(
      f.db,
      async () => {
        calls++;
      },
      { ...options, now: f.now },
    );
    assert.equal(await worker.tick(), "idle");
    assert.equal(calls, 0);
    assert.equal(
      autoSyncStatus(f.db, options.enabled, f.now()).workerOnline,
      true,
    );
    assert.equal(row(f.db).last_attempt_at, null);
    if (!options.enabled)
      assert.equal(autoSyncStatus(f.db, false, f.now()).nextRunAt, null);
    f.db.close();
  }
});

test("cancellation aborts an in-flight HTTP request without retrying or leaking request data", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener(
        "abort",
        () => reject(new Error("PRIVATE response")),
        { once: true },
      );
      setImmediate(() => controller.abort());
    });
  };
  await assert.rejects(
    requestJson("https://garmin.test", { signal: controller.signal }, fetcher),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(calls, 1);
});

test("cancelled sync retains the previous checkpoint and releases the Garmin lock", async () => {
  const f = fixture();
  f.commit();
  const prior = f.repository.status()!.lastCompletedAt;
  f.advance(60_000);
  const controller = new AbortController();
  await assert.rejects(
    runGarminSync(
      f.repository,
      {
        activities: async () => {
          controller.abort();
          return [];
        },
        health: async () => [],
        sleep: async () => [],
      },
      { now: f.now(), signal: controller.signal },
    ),
  );
  assert.equal(f.repository.status()!.lastCompletedAt, prior);
  assert.equal(f.db.prepare("SELECT * FROM sync_lock").all().length, 0);
  f.db.close();
});
