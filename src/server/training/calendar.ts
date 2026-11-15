import { countedActivityKm } from "../../shared/mileage";
import { raceRecoveryEvidence } from "./race-recovery";
import {
  applyAvailability,
  relocatedSession,
  withSessionIdentity,
} from "../../shared/schedule-editing";
import type {
  AvailabilityBlock,
  TrainingSlot,
} from "../../shared/types/rescheduling";
import { CommitmentRepository } from "./commitment-repository";
import { AthleteRepository } from "./athlete-repository";
import { returnReady } from "./commitments";
import { applyCommitments } from "../../shared/commitment-calendar";
import type Database from "better-sqlite3";
import type {
  TrainingPlan,
  ActivityMeasurement,
} from "../../shared/types/metrics";
import type {
  ScheduleChange,
  WeekPreferences,
  TrainingSession,
} from "../../shared/types/schedule";
import { ScheduleRepository } from "./schedule-repository";
import { TrainingRepository } from "./repository";
import {
  buildWeekSchedule,
  ScheduleRuleError,
} from "../../shared/weekly-schedule";
import { sameWorkout } from "../../shared/workout-identity";
import { calendarDate, shiftDay } from "./dates";
import { sportGroup } from "./metrics";

export type CalendarProjectionOptions = {
  changes?: ScheduleChange[];
  availability?: AvailabilityBlock[];
  canonical?: boolean;
  ignoreOverrides?: string[];
};
export function trainingCalendar(
  db: Database.Database,
  plan: TrainingPlan,
  activities: ActivityMeasurement[],
  now: Date,
  weekOverride?: WeekPreferences,
  projection: CalendarProjectionOptions = {},
) {
  const {
    changes: previewChanges = [],
    availability: availabilityOverride,
    canonical = false,
    ignoreOverrides = [],
  } = projection;
  const schedule = new ScheduleRepository(db),
    profile = schedule.preferences(),
    week = weekOverride ?? schedule.week(plan.start);
  const changes: ScheduleChange[] = schedule
    .changes(plan.start)
    .filter((c) => !ignoreOverrides.includes(c.day))
    .map((c) => ({
      ...c,
      sessions: c.sessions.filter(
        (s) => s.sport !== "running" || !s.workout.race,
      ),
    }));
  for (const preview of previewChanges) {
    const i = changes.findIndex((c) => c.day === preview.day);
    if (i >= 0) changes[i] = preview;
    else changes.push(preview);
  }
  for (const change of changes)
    for (const session of change.sessions)
      if (session.sport === "cycling")
        session.workout = { ...session.workout, ftpWatts: profile.ftpWatts };
  const base = buildWeekSchedule(plan, week, profile);
  for (const override of new TrainingRepository(db).overrides()) {
    if (changes.some((c) => c.day === override.day)) continue;
    const day = base.days.find((d) => d.day === override.day),
      run = day?.sessions.find((s) => s.session.sport === "running")?.session;
    if (
      !day ||
      !run ||
      run.sport !== "running" ||
      !sameWorkout(run.workout, override.before)
    )
      continue;
    changes.push({
      day: override.day,
      sessions: day.sessions.flatMap<TrainingSession>((s) =>
        s.session.sport === "running"
          ? override.workout
            ? [
                {
                  sport: "running" as const,
                  slot: "lunch" as const,
                  workout: override.workout,
                },
              ]
            : []
          : [s.session],
      ),
    });
  }
  const records = activities
    .filter(
      (a) =>
        Date.parse(a.startedAt) <= now.getTime() &&
        sportGroup(a) !== "wellness",
    )
    .map((a) => ({
      day: calendarDate(new Date(a.startedAt)),
      sport: sportGroup(a),
      minutes: Math.round((a.durationSeconds ?? 0) / 60),
      km:
        sportGroup(a) === "running"
          ? countedActivityKm(a)
          : (a.distanceMeters ?? 0) / 1000,
    }));
  const commitments = new CommitmentRepository(db);
  const rawCalendar = buildWeekSchedule(plan, week, profile, changes, records);
  if (canonical) return rawCalendar;
  const committed = applyCommitments(
    rawCalendar,
    plan,
    commitments.all(),
    new AthleteRepository(db).profile().targets,
    {
      today: calendarDate(now),
      allowMileageAllocation: plan.planningVersion === 2,
      returnReady: returnReady(db, now),
      raceRecovery: raceRecoveryEvidence(db, now),
      approvedRestDays: commitments.restDays(),
      longestRecentKm: Math.max(
        0,
        ...activities
          .filter(
            (a) =>
              sportGroup(a) === "running" &&
              calendarDate(new Date(a.startedAt)) >=
                shiftDay(calendarDate(now), -30) &&
              Date.parse(a.startedAt) <= now.getTime(),
          )
          .map((a) => (a.distanceMeters ?? 0) / 1000),
      ),
    },
  );
  const available = applyAvailability(
    committed,
    availabilityOverride ?? schedule.availability(),
  );
  return {
    ...available,
    days: available.days.map((day) => ({
      ...day,
      sessions: day.sessions.map((entry) => ({
        ...entry,
        session: withSessionIdentity(entry.session, day.day),
      })),
    })),
  };
}
export function moveRunningDay(
  db: Database.Database,
  plan: TrainingPlan,
  from: number,
  to: number,
  activities: ActivityMeasurement[],
  now: Date,
  slot: TrainingSlot = "lunch",
) {
  const calendar = trainingCalendar(db, plan, activities, now),
    source = calendar.days[from],
    target = calendar.days[to],
    today = calendarDate(now);
  if (
    !source ||
    !target ||
    from === to ||
    to === 6 ||
    source.day < today ||
    target.day < today
  )
    throw new ScheduleRuleError(
      "Move an upcoming run to another Monday–Saturday date in this week.",
    );
  const run = source.sessions.find((s) => s.session.sport === "running");
  if (
    !run ||
    run.status !== "planned" ||
    target.sessions.some((s) => s.session.sport === "running") ||
    target.recorded.some((r) => r.sport === "running")
  )
    throw new ScheduleRuleError(
      "Choose an uncompleted run and a day without another run.",
    );
  if (
    run.session.sport !== "running" ||
    run.session.workout.type === "race" ||
    target.rule
  )
    throw new ScheduleRuleError("Run unavailable.");
  if (
    target.recorded.length +
      target.sessions.filter((s) => s.status === "planned").length >=
    2
  )
    throw new ScheduleRuleError(
      "The destination day already has two workouts recorded or planned.",
    );
  const moved = relocatedSession(
    run,
    source,
    target,
    slot,
    plan.easyPace,
    today,
  );
  return [
    {
      day: source.day,
      sessions: source.sessions.filter((s) => s !== run).map((s) => s.session),
    },
    {
      day: target.day,
      sessions: [moved, ...target.sessions.map((s) => s.session)],
    },
  ] satisfies ScheduleChange[];
}

export function skipSecondarySession(
  db: Database.Database,
  plan: TrainingPlan,
  offset: number,
  activities: ActivityMeasurement[],
  now: Date,
) {
  const day = trainingCalendar(db, plan, activities, now).days[offset];
  if (!day || offset === 6 || day.day < calendarDate(now))
    throw new ScheduleRuleError("Choose an upcoming Monday–Saturday session.");
  const remaining = day.sessions
    .filter((s) => s.session.sport === "running" || s.status === "recorded")
    .map((s) => s.session);
  if (remaining.length === day.sessions.length)
    throw new ScheduleRuleError(
      "There is no uncompleted secondary session to skip.",
    );
  return [{ day: day.day, sessions: remaining }] satisfies ScheduleChange[];
}

export function trainingEvidencePlans(
  db: Database.Database,
  plans: TrainingPlan[],
  activities: ActivityMeasurement[],
  now: Date,
) {
  const today = calendarDate(now);
  return plans
    .filter((plan) => plan.start >= shiftDay(today, -28) && plan.start <= today)
    .filter(
      (plan) =>
        !trainingCalendar(db, plan, activities, now).days.some((d) => !!d.rule),
    )
    .map((plan) => ({
      ...plan,
      workouts: trainingCalendar(db, plan, activities, now).days.flatMap(
        (day) =>
          day.sessions.flatMap((entry) =>
            entry.session.sport === "running" ? [entry.session.workout] : [],
          ),
      ),
    }));
}
