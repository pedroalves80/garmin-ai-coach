import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/server/db/migrate";
import {
  GarminRepository,
  SyncBusyError,
} from "../src/server/db/garmin-repository";
import { GarminClient, endpoints } from "../src/server/garmin/client";
import { GarminTokenProvider } from "../src/server/garmin/auth";
import { requestJson, GarminHttpError } from "../src/server/garmin/http";
import { runGarminSync, syncRange } from "../src/server/garmin/sync";
import { dashboardData } from "../src/server/dashboard/data";
import {
  activityPage,
  parsePayload,
  GarminPayloadError,
} from "../src/server/garmin/schemas";

const now = new Date("2026-10-29T12:00:00Z");
test("Personal API plain-text JWT is cached and forwarded as the bearer token", async () => {
  const token = "header.payload.signature";
  let issued = 0;
  const client = new GarminClient("fixture-key", async (input, init) => {
    if (String(input).includes("/token")) {
      issued++;
      return new Response(token, { headers: { "Content-Type": "text/plain" } });
    }
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      `Bearer ${token}`,
    );
    return new Response("[]", {
      headers: { "Content-Type": "application/json" },
    });
  });
  await client.activities("2026-10-28", "2026-10-29");
  await client.sleep("2026-10-28", "2026-10-29");
  assert.equal(issued, 1);
});

test("unexpected plain-text responses are rejected without exposing their contents", async () => {
  const provider = new GarminTokenProvider(
    "fixture-key",
    async () => new Response("<html>private diagnostic</html>"),
  );
  await assert.rejects(
    provider.get(),
    (error) =>
      error instanceof GarminPayloadError &&
      !error.message.includes("private diagnostic"),
  );
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
function activity(id: number, distance = 5000) {
  return {
    activityId: id,
    activityName: "Lunch run",
    startTimeGMT: "2026-10-28 12:00:00",
    activityType: { typeKey: "running" },
    duration: 1800.5,
    distance,
    averageHR: 145,
    maxHR: 165,
  };
}
function database() {
  const sqlite = new Database(":memory:");
  migrateDatabase(sqlite);
  migrateDatabase(sqlite); // Existing installs must survive repeated startup.
  return { sqlite, repository: new GarminRepository(sqlite) };
}

test("sync paginates, persists units and nested health, reimports corrections without duplicates", async () => {
  const { sqlite, repository } = database();
  let distance = 5000;
  let tokenCalls = 0;
  const offsets: string[] = [];
  const windows: { start: string; end: string }[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/token")) {
      tokenCalls++;
      return json({ access_token: "fixture-token", expires_in: 86400 });
    }
    const start = url.searchParams.get("startDate")!;
    const end = url.searchParams.get("endDate")!;
    const inWindow = start <= "2026-10-28" && end >= "2026-10-28";
    if (url.pathname === endpoints.activities) {
      offsets.push(url.searchParams.get("start")!);
      const items = inWindow
        ? Array.from({ length: 100 }, (_, i) => activity(i + 1, distance))
        : [];
      const offset = Number(url.searchParams.get("start"));
      return json(items.slice(offset, offset + 99));
    }
    if (url.pathname === endpoints.health)
      return json({
        data: inWindow
          ? [
              {
                calendarDate: "2026-10-28",
                heartRate: { restingValue: 52 },
                bodyBattery: { latestValue: 63 },
              },
            ]
          : [],
      });
    if (url.pathname === endpoints.sleep) {
      windows.push({ start, end });
      return json(
        inWindow
          ? [{ calendarDate: "2026-10-28", sleepTimeSeconds: 27000 }]
          : [],
      );
    }
    throw new Error("Unexpected endpoint");
  };
  try {
    const client = new GarminClient("fixture-key", fetcher);
    const first = await runGarminSync(repository, client, { now });
    assert.equal(first.importedActivities, 100);
    assert.equal(repository.allActivities().length, 100);
    assert(offsets.includes("99"));
    assert(
      windows.every(
        ({ start, end }) =>
          (Date.parse(end) - Date.parse(start)) / 86400000 <= 30,
      ),
    );
    const stored = repository.recentActivities()[0];
    assert.equal(stored.distanceMeters, 5000);
    assert.equal(stored.durationSeconds, 1800.5);
    assert.equal(stored.startedAt, "2026-10-28T12:00:00Z");
    assert.equal(stored.sportType, "running");
    assert.equal(repository.latestHealth()?.sleepSeconds, 27000);
    assert.equal(repository.latestHealth()?.restingHeartRate, 52);
    assert.equal(repository.latestHealth()?.bodyBattery, 63);
    distance = 6200;
    await runGarminSync(repository, client, {
      now: new Date("2026-10-30T12:00:00Z"),
    });
    assert.equal(repository.allActivities().length, 100);
    assert.equal(repository.recentActivities()[0].distanceMeters, 6200);
    assert.equal(tokenCalls, 1);
    assert.equal(
      repository.status()?.lastCompletedAt,
      "2026-10-30T12:00:00.000Z",
    );
    assert.equal(dashboardData(repository, now).runningKm, 620);
  } finally {
    sqlite.close();
  }
});

test("a failed health request preserves the previous checkpoint and all imported data", async () => {
  const { sqlite, repository } = database();
  let fail = false;
  const source = {
    activities: async () =>
      parsePayload(activityPage, [activity(1, fail ? 9000 : 5000)]),
    health: async () => [],
    sleep: async () => {
      if (fail) throw new Error("Garmin health unavailable");
      return [];
    },
  };
  try {
    await runGarminSync(repository, source, { now });
    fail = true;
    await assert.rejects(
      runGarminSync(repository, source, {
        now: new Date("2026-10-30T12:00:00Z"),
      }),
      /health unavailable/,
    );
    assert.equal(repository.status()?.lastCompletedAt, now.toISOString());
    assert.equal(repository.recentActivities()[0].distanceMeters, 5000);
    assert.equal(repository.isRunning(), false);
    fail = false;
    await runGarminSync(repository, source, {
      now: new Date("2026-10-31T12:00:00Z"),
    });
    assert.equal(repository.status()?.lastError, null);
  } finally {
    sqlite.close();
  }
});

test("malformed Garmin data fails validation instead of marking an empty sync successful", async () => {
  const client = new GarminClient("fixture-key", async (input) =>
    String(input).includes("/token")
      ? json({ access_token: "token" })
      : json({ unexpected: [] }),
  );
  await assert.rejects(
    client.activities("2026-10-28", "2026-10-29"),
    GarminPayloadError,
  );
  assert.throws(
    () => parsePayload(activityPage, [activity(1, -1)]),
    GarminPayloadError,
  );
  assert.throws(
    () =>
      parsePayload(activityPage, [
        { ...activity(1), startTimeGMT: "not-a-date" },
      ]),
    GarminPayloadError,
  );
});

test("overlapping pages terminate instead of looping", async () => {
  const client = new GarminClient("fixture-key", async (input) =>
    String(input).includes("/token")
      ? json({ access_token: "token" })
      : json(Array.from({ length: 99 }, (_, i) => activity(i + 1))),
  );
  await assert.rejects(
    client.activities("2026-10-28", "2026-10-29"),
    /overlapping/,
  );
});

test("tokens coalesce concurrent requests; a rejected token is renewed once", async () => {
  let issued = 0;
  const tokens = new GarminTokenProvider("fixture-key", async () => {
    issued++;
    return json({ access_token: "cached", expires_in: 86400 });
  });
  await Promise.all([tokens.get(), tokens.get(), tokens.get()]);
  assert.equal(issued, 1);
  let activityCalls = 0;
  const client = new GarminClient("fixture-key", async (input) => {
    if (String(input).includes("/token")) {
      issued++;
      return json({ access_token: "renewed" });
    }
    activityCalls++;
    return activityCalls === 1 ? json({}, 401) : json([]);
  });
  await client.activities("2026-10-28", "2026-10-29");
  assert.equal(activityCalls, 2);
  assert.equal(issued, 3);
});

test("transient responses retry, Retry-After is bounded, and authorization failures do not retry", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await requestJson(
    "https://example.test",
    {},
    async () => {
      calls++;
      return calls === 1
        ? new Response("", { status: 429, headers: { "Retry-After": "900" } })
        : json({ ok: true });
    },
    async (ms) => {
      delays.push(ms);
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(delays, [10000]);
  calls = 0;
  await assert.rejects(
    requestJson(
      "https://example.test",
      {},
      async () => {
        calls++;
        return json({}, 403);
      },
      async () => {},
    ),
    GarminHttpError,
  );
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    requestJson(
      "https://example.test",
      {},
      async () => {
        calls++;
        throw new Error("timeout");
      },
      async () => {},
    ),
    /could not be reached/,
  );
  assert.equal(calls, 3);
});

test("concurrent syncs are refused and seven-day lookback includes recent corrections", () => {
  const { sqlite, repository } = database();
  try {
    const owner = repository.acquire(now);
    assert.throws(() => repository.acquire(now), SyncBusyError);
    repository.release(owner);
    assert.deepEqual(syncRange("2026-10-28T22:00:00Z", now), {
      start: "2026-10-21",
      end: "2026-10-29",
    });
    assert.deepEqual(syncRange(null, now), {
      start: "2026-08-01",
      end: "2026-10-29",
    });
  } finally {
    sqlite.close();
  }
});

test("dashboard uses Lisbon week boundaries and separates running from cycling", () => {
  const { sqlite, repository } = database();
  try {
    const owner = repository.acquire(now);
    repository.commit(
      {
        activities: parsePayload(activityPage, [
          activity(1),
          { ...activity(2, 20000), activityType: { typeKey: "virtual_ride" } },
          { ...activity(3), startTimeGMT: "2026-10-25 12:00:00" },
        ]),
        health: [],
        sleep: [],
      },
      now,
      owner,
    );
    repository.release(owner);
    const view = dashboardData(repository, now);
    assert.equal(view.runningKm, 5);
    assert.equal(view.runningCount, 1);
    assert.equal(view.weekStart, "2026-10-26");
    assert.equal(view.health, null);
    assert(!("rawJson" in view.activities[0]));
  } finally {
    sqlite.close();
  }
});
