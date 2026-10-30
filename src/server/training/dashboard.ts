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
import { ScheduleRepository } from "./schedule-repository";
import { AthleteRepository } from "./athlete-repository";
import { measuredLoad, combinedLoadReview } from "./load";
import { developmentReadiness } from "./development";
import { trainingCalendar, trainingEvidencePlans } from "./calendar";

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
  const todayRuns = activities.filter(
    (a) =>
      sportGroup(a) === "running" &&
      calendarDate(new Date(a.startedAt)) === today,
  );
  const overrides = repository.overrides();
  const scheduled =
    currentPlan?.workouts.find(
      (w) => shiftDay(currentPlan.start, w.dayOffset) === today,
    ) ?? null;
  const todayOverride = overrides.find((o) => o.day === today);
  const scheduleRepository = new ScheduleRepository(sqlite);
  const calendar = currentPlan
    ? trainingCalendar(sqlite, currentPlan, activities, now)
    : null;
  const todaySessions = calendar?.days.find((d) => d.day === today) ?? null;
  const effectiveRuns =
    calendar?.days.flatMap((d) =>
      d.sessions.flatMap((s) =>
        s.session.sport === "running" ? [s.session.workout] : [],
      ),
    ) ?? [];
  const athleteRepository = new AthleteRepository(sqlite),
    athlete = athleteRepository.profile(),
    efforts = athleteRepository.efforts();
  const load = combinedLoadReview(measuredLoad(activities, efforts, now));
  const development = developmentReadiness(
    athlete,
    trainingEvidencePlans(sqlite, plans, activities, now),
    activities,
    efforts,
    checkIns,
    load,
    now,
    lastSync,
  );
  const calendarRun = todaySessions?.sessions.find(
    (s) => s.session.sport === "running",
  )?.session;
  return {
    today,
    athlete,
    development,
    load,
    plans,
    effortSessions: activities
      .filter(
        (a) =>
          calendarDate(new Date(a.startedAt)) >= shiftDay(today, -35) &&
          sportGroup(a) !== "wellness",
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 100)
      .map((a) => ({
        id: a.id,
        day: calendarDate(new Date(a.startedAt)),
        sport: sportGroup(a),
        minutes: (a.durationSeconds ?? 0) / 60,
        km: (a.distanceMeters ?? 0) / 1000,
        rpe: efforts.find((e) => e.activityId === a.id)?.rpe ?? null,
        prescriptionCompleted:
          efforts.find((e) => e.activityId === a.id)?.prescriptionCompleted ??
          false,
      })),
    todayRunning: {
      runs: todayRuns.length,
      km: todayRuns.reduce((sum, a) => sum + (a.distanceMeters ?? 0) / 1000, 0),
      minutes: todayRuns.reduce(
        (sum, a) => sum + (a.durationSeconds ?? 0) / 60,
        0,
      ),
    },
    todayWorkout: todaySessions
      ? calendarRun?.sport === "running"
        ? calendarRun.workout
        : null
      : todayOverride
        ? todayOverride.workout
        : scheduled,
    todaySessions,
    calendar,
    previewCalendar: previewPlan
      ? trainingCalendar(sqlite, previewPlan, activities, now)
      : null,
    preferences: scheduleRepository.preferences(),
    weekSettings: scheduleRepository.weeks(),
    weekPreferences: scheduleRepository.week(
      previewPlan?.start ?? shiftDay(monday, 7),
    ),
    scheduleChanges: scheduleRepository.changes(
      previewPlan?.start ?? shiftDay(monday, 7),
    ),
    monday,
    weeks,
    averageKm: average,
    weekChangePercent:
      prior.runningKm > 0
        ? (recent.runningKm / prior.runningKm - 1) * 100
        : null,
    synced: !!lastSync,
    lastSync,
    comparison: comparableRuns(activities, now, {
      min: athlete.targets.baseMin,
      max: athlete.targets.baseMax,
    }),
    checkIns,
    todayCheckIn: checkIns.find((c) => c.day === today) ?? null,
    currentPlan,
    previewPlan,
    overrides,
    plannedKm: currentPlan ? planKm(currentPlan) : null,
    completion: currentPlan
      ? workoutCompletion(
          { ...currentPlan, workouts: effectiveRuns },
          activities,
          today,
        )
      : [],
    progression: assessProgression({
      now,
      plans,
      weeks,
      checkIns,
      activities,
      lastSync,
      load,
    }),
  };
}

export type TrainingDashboardData = ReturnType<typeof trainingDashboardData>;
