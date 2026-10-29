import { GarminRepository } from "../db/garmin-repository";
import { GarminClient } from "./client";
import type { GarminActivity, GarminHealth, GarminSleep } from "./schemas";

export function calendarDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function syncRange(
  lastCompleted: string | null,
  now: Date,
  full = false,
) {
  const end = calendarDate(now);
  return {
    start:
      lastCompleted && !full
        ? shiftDay(calendarDate(new Date(lastCompleted)), -7)
        : shiftDay(end, -89),
    end,
  };
}

type Source = Pick<GarminClient, "activities" | "health" | "sleep">;

export async function runGarminSync(
  repository: GarminRepository,
  source: Source,
  options: { now?: Date; full?: boolean; signal?: AbortSignal } = {},
) {
  const now = options.now ?? new Date();
  const range = syncRange(
    repository.status()?.lastCompletedAt ?? null,
    now,
    options.full,
  );
  const owner = repository.acquire(now);
  try {
    const batch: {
      activities: GarminActivity[];
      health: GarminHealth[];
      sleep: GarminSleep[];
    } = { activities: [], health: [], sleep: [] };
    // Inclusive chunks of at most 31 days comply with the sleep endpoint limit.
    for (
      let start = range.start;
      start <= range.end;
      start = shiftDay(start, 31)
    ) {
      const end =
        shiftDay(start, 30) < range.end ? shiftDay(start, 30) : range.end;
      options.signal?.throwIfAborted();
      batch.activities.push(
        ...(await source.activities(start, end, options.signal)),
      );
      options.signal?.throwIfAborted();
      batch.health.push(...(await source.health(start, end, options.signal)));
      options.signal?.throwIfAborted();
      batch.sleep.push(...(await source.sleep(start, end, options.signal)));
    }
    options.signal?.throwIfAborted();
    repository.commit(batch, now, owner);
    return {
      importedActivities: batch.activities.length,
      healthDays: new Set(
        [...batch.health, ...batch.sleep].map((item) => item.calendarDate),
      ).size,
      ...range,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Garmin sync failed.";
    repository.fail(message, now);
    throw error;
  } finally {
    repository.release(owner);
  }
}
