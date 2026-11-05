import type { AvailabilityBlock, TrainingSlot } from "./types/rescheduling";
import type {
  ScheduledDay,
  SessionState,
  TrainingSession,
  WeekSchedule,
} from "./types/schedule";
import { isDistanceWorkout, minimumRunKm, workoutKm } from "./training-plan";
import { ScheduleRuleError, validateDaySessions } from "./weekly-schedule";

export function sessionIdentity(session: TrainingSession, day: string) {
  return session.id ?? `${day}:${session.sport}`;
}
export function withSessionIdentity(
  session: TrainingSession,
  day: string,
): TrainingSession {
  return { ...session, id: sessionIdentity(session, day) };
}
export function applyAvailability(
  calendar: WeekSchedule,
  blocks: AvailabilityBlock[],
): WeekSchedule {
  return {
    ...calendar,
    days: calendar.days.map((day) => {
      const slots = blocks.find((b) => b.day === day.day)?.slots ?? [];
      const removed = day.sessions.filter(
        (s) =>
          s.status !== "recorded" &&
          (s.session.slot === "event"
            ? slots.length > 0
            : slots.includes(s.session.slot)),
      );
      return {
        ...day,
        unavailableSlots: slots,
        sessions: day.sessions.filter((s) => !removed.includes(s)),
        warnings: [
          ...day.warnings,
          ...(removed.length
            ? [
                day.race
                  ? "Availability conflicts with this race. The event remains in your calendar but is not prescribed; review the event or availability."
                  : "Unavailable training windows are excluded. Removed workouts are not automatically made up.",
              ]
            : []),
        ],
      };
    }),
  };
}
export function editableSession(
  day: ScheduledDay,
  id: string,
  today: string,
  allowBlocked = false,
) {
  if (day.day < today)
    throw new ScheduleRuleError(
      "Past sessions stay in history. Choose today or a future date.",
    );
  const entry = day.sessions.find(
    (s) => sessionIdentity(s.session, day.day) === id,
  );
  if (
    !entry ||
    entry.status === "recorded" ||
    (!allowBlocked && entry.status !== "planned")
  )
    throw new ScheduleRuleError(
      "Choose an uncompleted, available session. Sync Garmin if you have already trained.",
    );
  if (
    entry.session.sport === "running" &&
    (entry.session.workout.race || entry.session.workout.type === "race")
  )
    throw new ScheduleRuleError(
      "Race dates and courses are fixed. Edit the race in the event calendar instead.",
    );
  return entry;
}
export function relocatedSession(
  entry: SessionState,
  source: ScheduledDay,
  target: ScheduledDay,
  slot: TrainingSlot,
  easyPace: number,
  today: string,
  excludingId?: string,
): TrainingSession {
  editableSession(source, sessionIdentity(entry.session, source.day), today);
  if (source.rule || target.rule || target.race)
    throw new ScheduleRuleError(
      "Race, recovery and break rules protect this date. Review the calendar commitment instead.",
    );
  if (target.day < today || target.dayOffset === 6)
    throw new ScheduleRuleError(
      "Choose today or a future Monday–Saturday date. Sunday remains rest.",
    );
  if (entry.session.sport === "hyrox")
    throw new ScheduleRuleError(
      "Hyrox attendance belongs to its fixed class date. Change class attendance in Plan instead.",
    );
  if (target.unavailableSlots?.includes(slot))
    throw new ScheduleRuleError("That training window is marked unavailable.");
  const remaining = target.sessions.filter(
    (s) =>
      sessionIdentity(s.session, target.day) !== excludingId &&
      sessionIdentity(s.session, target.day) !==
        sessionIdentity(entry.session, source.day),
  );
  if (target.recorded.some((r) => r.sport === entry.session.sport))
    throw new ScheduleRuleError(
      "A workout of this sport is already recorded on the destination date.",
    );
  if (
    target.recorded.length +
      remaining.filter((s) => s.status !== "recorded").length >=
    2
  )
    throw new ScheduleRuleError(
      "The destination already has two recorded or planned workouts. Skip a supporting session first.",
    );
  const session: TrainingSession =
    entry.session.sport === "running"
      ? {
          ...entry.session,
          id: sessionIdentity(entry.session, source.day),
          slot,
          workout: { ...entry.session.workout, dayOffset: target.dayOffset },
        }
      : {
          ...entry.session,
          id: sessionIdentity(entry.session, source.day),
          slot,
        };
  if (
    session.sport === "running" &&
    (!isDistanceWorkout(session.workout) ||
      workoutKm(session.workout, easyPace) < minimumRunKm - 1e-8)
  )
    throw new ScheduleRuleError(
      "Training runs require distance steps totaling at least 5 km.",
    );
  validateDaySessions(
    target.dayOffset,
    [...remaining.map((s) => s.session), session],
    easyPace,
  );
  return session;
}

// Recovery checks use adjacent calendar dates, including a neighbouring reviewed week.
export function recoveryWarnings(days: ScheduledDay[], affected: string[]) {
  const ordered = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const warnings: string[] = [];
  const keyRun = (day: ScheduledDay) =>
    day.sessions.some(
      (s) =>
        s.session.sport === "running" &&
        ["quality", "long", "race"].includes(s.session.workout.type),
    );
  for (let i = 0; i < ordered.length - 1; i++) {
    const day = ordered[i],
      next = ordered[i + 1];
    const following = new Date(`${day.day}T12:00:00Z`);
    following.setUTCDate(following.getUTCDate() + 1);
    if (
      following.toISOString().slice(0, 10) !== next.day ||
      ![day.day, next.day].some((d) => affected.includes(d))
    )
      continue;
    if (keyRun(next) && day.sessions.some((s) => s.session.sport === "running"))
      warnings.push(
        `${day.day} → ${next.day}: running on consecutive days before a key run. Check recovery and keep the moved prescription controlled.`,
      );
    if (keyRun(day) && keyRun(next))
      warnings.push(
        `${day.day} → ${next.day}: key runs are on consecutive days. Prefer another date or review the sessions with the coach.`,
      );
    if (keyRun(day) && keyRun(next))
      warnings.push(
        `${day.day} → ${next.day}: key runs are on consecutive days. Prefer another date or review the sessions with the coach.`,
      );
    else if (
      keyRun(next) &&
      day.sessions.some((s) => s.session.sport === "running")
    )
      warnings.push(
        `${day.day} → ${next.day}: running on consecutive days before a key run. Check recovery and keep the moved prescription controlled.`,
      );
    if (keyRun(next) && day.sessions.some((s) => s.session.sport === "hyrox"))
      warnings.push(
        `${day.day}: demanding Hyrox precedes the next key run. Review the class or choose another day.`,
      );
  }
  return warnings;
}
