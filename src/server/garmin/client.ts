import { GarminTokenProvider } from "./auth";
import { GarminHttpError, requestJson } from "./http";
import {
  activityPage,
  healthPage,
  sleepPage,
  parsePayload,
  type GarminActivity,
  type GarminHealth,
  type GarminSleep,
} from "./schemas";

const base = "https://personal.connectapi.garmin.com";
export const endpoints = {
  activities: "/activitylist-service/activities/search/activities",
  health: "/usersummary-service/v2/dailysummaries",
  sleep: "/sleep-service/sleep/dailySleepSummariesByDate",
} as const;

export class GarminClient {
  private readonly tokens: GarminTokenProvider;
  constructor(
    key: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.tokens = new GarminTokenProvider(key, fetcher);
  }

  private async get(
    path: string,
    query: Record<string, string>,
    signal?: AbortSignal,
    renewed = false,
  ): Promise<unknown> {
    const token = await this.tokens.get(signal);
    const url = new URL(path, base);
    url.search = new URLSearchParams(query).toString();
    try {
      return await requestJson(
        url.toString(),
        {
          signal,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        },
        this.fetcher,
      );
    } catch (error) {
      if (
        error instanceof GarminHttpError &&
        error.status === 401 &&
        !renewed
      ) {
        this.tokens.invalidate();
        return this.get(path, query, signal, true);
      }
      throw error;
    }
  }

  async activities(
    startDate: string,
    endDate: string,
    signal?: AbortSignal,
  ): Promise<GarminActivity[]> {
    const all: GarminActivity[] = [];
    const seen = new Set<string>();
    for (let start = 0; start < 100_000; start += 99) {
      const page = parsePayload(
        activityPage,
        (await this.get(
          endpoints.activities,
          {
            startDate,
            endDate,
            start: String(start),
            limit: "99",
            sortOrder: "asc",
            excludeChildren: "true",
          },
          signal,
        )) ?? [],
      );
      for (const item of page) {
        const id = String(item.activityId);
        if (seen.has(id))
          throw new Error(
            "Garmin returned overlapping activity pages; retry the sync.",
          );
        seen.add(id);
        all.push(item);
      }
      if (page.length < 99) return all;
    }
    throw new Error(
      "Garmin pagination limit reached; checkpoint not advanced.",
    );
  }

  async health(
    startDate: string,
    endDate: string,
    signal?: AbortSignal,
  ): Promise<GarminHealth[]> {
    const value = await this.get(
      endpoints.health,
      { startDate, endDate },
      signal,
    );
    return value === undefined ? [] : parsePayload(healthPage, value).data;
  }

  async sleep(
    startDate: string,
    endDate: string,
    signal?: AbortSignal,
  ): Promise<GarminSleep[]> {
    return parsePayload(
      sleepPage,
      (await this.get(endpoints.sleep, { startDate, endDate }, signal)) ?? [],
    );
  }
}
