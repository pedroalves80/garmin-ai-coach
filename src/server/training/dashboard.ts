import { getDatabase } from "../db/client";
import { GarminRepository } from "../db/garmin-repository";
import { TrainingRepository } from "./repository";
import { weeklyMetrics, comparableRuns, sportGroup } from "./metrics";
import { assessProgression } from "./progression";
import { calendarDate, mondayOf, shiftDay } from "./dates";
import { planKm, workoutKm } from "../../shared/training-plan";
import type {
  ActivityMeasurement,
  TrainingPlan,
} from "../../shared/types/metrics";

export function workoutCompletion(
  plan: TrainingPlan,
  activities: ActivityMeasurement[],
  today: string,
) {
  return plan.workouts.map((workout) => {
    const day = shiftDay(plan.start, workout.dayOffset);
    const recordedKm = activities
      .filter(
        (a) =>
          sportGroup(a) === "running" &&
          calendarDate(new Date(a.startedAt)) === day,
      )
      .reduce((sum, a) => sum + (a.distanceMeters ?? 0) / 1000, 0);
    const plannedKm = workoutKm(workout, plan.easyPace);
    return {
      day,
      title: workout.title,
      plannedKm,
      recordedKm,
      status:
        recordedKm >= plannedKm * 0.9
          ? "distance met"
          : recordedKm > 0
            ? "partial"
            : day < today
              ? "not recorded"
              : "planned",
    };
  });
}

export function trainingDashboardData(now = new Date()) {
  const sqlite = getDatabase();
  const garmin = new GarminRepository(sqlite),
    repository = new TrainingRepository(sqlite);
  const activities = garmin
    .allActivities()
    .filter((a) => Date.parse(a.startedAt) <= now.getTime());
  const weeks = weeklyMetrics(activities, now);
  const plans = repository.plans();
  const checkIns = repository.checkIns();
  const today = calendarDate(now),
    monday = mondayOf(today);
  const currentPlan = plans.find((p) => p.start === monday) ?? null;
  const previewPlan =
    currentPlan ??
    [...plans]
      .filter((p) => p.start > monday)
      .sort((a, b) => a.start.localeCompare(b.start))[0] ??
    null;
  const completed = weeks.filter((w) => !w.partial);
  const average = completed.reduce((sum, w) => sum + w.runningKm, 0) / 4;
  const recent = completed.at(-1)!,
    prior = completed.at(-2)!;
  const lastSync = garmin.status()?.lastCompletedAt ?? null;
  return {
    today,
    monday,
    weeks,
    averageKm: average,
    weekChangePercent:
      prior.runningKm > 0
        ? (recent.runningKm / prior.runningKm - 1) * 100
        : null,
    synced: !!lastSync,
    lastSync,
    comparison: comparableRuns(activities, now),
    checkIns,
    todayCheckIn: checkIns.find((c) => c.day === today) ?? null,
    currentPlan,
    previewPlan,
    overrides: repository.overrides(),
    plannedKm: currentPlan ? planKm(currentPlan) : null,
    completion: currentPlan
      ? workoutCompletion(currentPlan, activities, today)
      : [],
    progression: assessProgression({
      now,
      plans,
      weeks,
      checkIns,
      activities,
      lastSync,
    }),
  };
}

export type TrainingDashboardData = ReturnType<typeof trainingDashboardData>;
