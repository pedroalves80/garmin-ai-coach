import type {
  ActivityMeasurement,
  TrainingWeek,
} from "../../shared/types/metrics";
import { calendarDate, mondayOf, shiftDay } from "./dates";

export function sportGroup(
  item: Pick<ActivityMeasurement, "sportType" | "name">,
) {
  const type = item.sportType.toLowerCase();
  if (/\bhyrox\b/i.test(item.name ?? "") || type.includes("hyrox"))
    return "hyrox";
  if (
    [
      "running",
      "trail_running",
      "treadmill_running",
      "track_running",
      "virtual_run",
      "virtual_running",
      "ultra_run",
      "indoor_running",
    ].includes(type)
  )
    return "running";
  if (
    type === "cycling" ||
    type.endsWith("_cycling") ||
    type === "virtual_ride" ||
    type === "indoor_cycling"
  )
    return "cycling";
  if (["meditation", "breathwork", "breathing", "yoga"].includes(type))
    return "wellness";
  return "other";
}

export function weeklyMetrics(
  activities: ActivityMeasurement[],
  now: Date,
): TrainingWeek[] {
  const current = mondayOf(calendarDate(now));
  return Array.from({ length: 5 }, (_, i) => {
    const start = shiftDay(current, (i - 4) * 7);
    const end = shiftDay(start, 7);
    const week: TrainingWeek = {
      start,
      partial: i === 4,
      runningKm: 0,
      runningMinutes: 0,
      runs: 0,
      cyclingMinutes: 0,
      hyroxMinutes: 0,
      otherMinutes: 0,
      wellnessMinutes: 0,
      longestKm: 0,
    };
    for (const item of activities) {
      if (Date.parse(item.startedAt) > now.getTime()) continue;
      const day = calendarDate(new Date(item.startedAt));
      if (day < start || day >= end) continue;
      const minutes = (item.durationSeconds ?? 0) / 60;
      const group = sportGroup(item);
      if (group === "running") {
        const km = (item.distanceMeters ?? 0) / 1000;
        week.runningKm += km;
        week.runningMinutes += minutes;
        week.runs++;
        week.longestKm = Math.max(week.longestKm, km);
      } else if (group === "cycling") week.cyclingMinutes += minutes;
      else if (group === "hyrox") week.hyroxMinutes += minutes;
      else if (group === "wellness") week.wellnessMinutes += minutes;
      else week.otherMinutes += minutes;
    }
    return week;
  });
}

type Sample = {
  item: ActivityMeasurement;
  pace: number;
  elevation: number;
  lat: number;
  lon: number;
  temperature: number | null;
};
function sample(item: ActivityMeasurement): Sample | null {
  if (
    item.sportType !== "running" ||
    !item.distanceMeters ||
    !item.durationSeconds ||
    !item.averageHeartRate ||
    item.averageHeartRate < 135 ||
    item.averageHeartRate > 150 ||
    item.distanceMeters < 3000 ||
    item.distanceMeters > 15000
  )
    return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(item.rawJson);
  } catch {
    return null;
  }
  const number = (key: string) =>
    typeof raw[key] === "number" && Number.isFinite(raw[key])
      ? (raw[key] as number)
      : null;
  const gain = number("elevationGain"),
    lat = number("startLatitude"),
    lon = number("startLongitude");
  if (gain === null || gain < 0 || lat === null || lon === null) return null;
  const low = number("minTemperature"),
    high = number("maxTemperature");
  return {
    item,
    pace: item.durationSeconds / (item.distanceMeters / 1000),
    elevation: gain / (item.distanceMeters / 1000),
    lat,
    lon,
    temperature: low !== null && high !== null ? (low + high) / 2 : null,
  };
}

export function comparableRuns(activities: ActivityMeasurement[], now: Date) {
  const cutoff = now.getTime() - 28 * 86400000;
  const oldest = now.getTime() - 56 * 86400000;
  const samples = activities
    .filter(
      (a) =>
        Date.parse(a.startedAt) <= now.getTime() &&
        Date.parse(a.startedAt) >= oldest,
    )
    .map(sample)
    .filter((x): x is Sample => x !== null);
  const recent = samples
    .filter((x) => Date.parse(x.item.startedAt) >= cutoff)
    .sort((a, b) => a.item.startedAt.localeCompare(b.item.startedAt));
  const prior = samples.filter((x) => Date.parse(x.item.startedAt) < cutoff);
  const used = new Set<string>();
  const pairs: {
    before: number;
    after: number;
    delta: number;
    weatherMissing: boolean;
  }[] = [];
  for (const next of recent) {
    const candidates = prior
      .filter((old) => {
        const kmApart = Math.hypot(
          (next.lat - old.lat) * 111,
          (next.lon - old.lon) * 111 * Math.cos((next.lat * Math.PI) / 180),
        );
        return (
          !used.has(old.item.id) &&
          kmApart <= 0.25 &&
          Math.abs(next.item.averageHeartRate! - old.item.averageHeartRate!) <=
            3 &&
          Math.abs(next.item.distanceMeters! / old.item.distanceMeters! - 1) <=
            0.1 &&
          Math.abs(next.elevation - old.elevation) <= 5 &&
          (next.temperature === null ||
            old.temperature === null ||
            Math.abs(next.temperature - old.temperature) <= 5)
        );
      })
      .sort(
        (a, b) =>
          Math.abs(a.item.averageHeartRate! - next.item.averageHeartRate!) -
            Math.abs(b.item.averageHeartRate! - next.item.averageHeartRate!) ||
          a.item.id.localeCompare(b.item.id),
      );
    if (!candidates.length) continue;
    const old = candidates[0];
    used.add(old.item.id);
    pairs.push({
      before: old.pace,
      after: next.pace,
      delta: next.pace - old.pace,
      weatherMissing: next.temperature === null || old.temperature === null,
    });
  }
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const i = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
  };
  return {
    pairs: pairs.length,
    beforePace: pairs.length >= 3 ? median(pairs.map((p) => p.before)) : null,
    afterPace: pairs.length >= 3 ? median(pairs.map((p) => p.after)) : null,
    secondsPerKmChange:
      pairs.length >= 3 ? median(pairs.map((p) => p.delta)) : null,
    weatherMissing: pairs.some((p) => p.weatherMissing),
  };
}
