import { GarminRepository } from "../db/garmin-repository";
import { getDatabase } from "../db/client";
import { calendarDate, shiftDay } from "../garmin/sync";

export function dashboardData(
  repository = new GarminRepository(getDatabase()),
  now = new Date(),
) {
  const today = calendarDate(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = shiftDay(today, -((weekday + 6) % 7));
  const nextMonday = shiftDay(monday, 7);
  const week = repository.allActivities().filter((item) => {
    const day = calendarDate(new Date(item.startedAt));
    return (
      day >= monday &&
      day < nextMonday &&
      Date.parse(item.startedAt) <= now.getTime()
    );
  });
  const runs = week.filter((item) =>
    [
      "running",
      "trail_running",
      "treadmill_running",
      "track_running",
      "virtual_run",
      "ultra_run",
      "indoor_running",
    ].includes(item.sportType),
  );
  const health = repository.latestHealth();
  return {
    weekStart: monday,
    runningKm:
      runs.reduce((total, item) => total + (item.distanceMeters ?? 0), 0) /
      1000,
    runningCount: runs.length,
    trainingMinutes:
      week.reduce((total, item) => total + (item.durationSeconds ?? 0), 0) / 60,
    lastSync: repository.status(),
    health: health
      ? {
          day: health.day,
          sleepSeconds: health.sleepSeconds,
          restingHeartRate: health.restingHeartRate,
          bodyBattery: health.bodyBattery,
        }
      : null,
    activities: repository
      .recentActivities()
      .map(
        ({
          id,
          name,
          sportType,
          startedAt,
          durationSeconds,
          distanceMeters,
          averageHeartRate,
        }) => ({
          id,
          name,
          sportType,
          startedAt,
          durationSeconds,
          distanceMeters,
          averageHeartRate,
        }),
      ),
  };
}

export type DashboardData = ReturnType<typeof dashboardData>;
