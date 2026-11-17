import { createTrainingPlan } from "./training-plan";
import { forecastTempoLevel } from "./tempo-progression";
import { milestoneForWeek, distributeMileage } from "./milestones";
import { dayOffsetDate } from "./weekly-schedule";
import { eventOnlyPlan } from "./commitment-calendar";
import { developedPlan } from "./plan-development";
import { volumeMilestones } from "./training-plan";
import type { TrainingPlan } from "./types/metrics";
import type { AthleteProfile } from "./types/athlete";
import type { WeekPreferences } from "./types/schedule";
export function weekMonday(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    throw new Error("Choose a valid date");
  return dayOffsetDate(day, -((date.getUTCDay() + 6) % 7));
}
export function weekView(
  start: string,
  context: {
    monday: string;
    plans: TrainingPlan[];
    prepared: TrainingPlan;
    athlete: AthleteProfile;
    longestRecentKm?: number;
  },
) {
  const { monday, plans, prepared, athlete } = context;
  const saved = plans.find((p) => p.start === start);
  const expected = milestoneForWeek(start, plans);
  const correction =
    !!saved && start >= monday && saved.weekNumber !== expected.stage;
  if (saved && !correction) return { plan: saved, kind: "reviewed" as const };
  if (start === prepared.start && (!saved || correction))
    return {
      plan: prepared,
      kind: correction ? ("correction" as const) : ("prepared" as const),
    };
  if (start === monday) return { plan: prepared, kind: "prepared" as const };
  if (start < monday)
    return {
      plan: eventOnlyPlan(start, athlete.easyPace, athlete.tempoPace),
      kind: "unplanned" as const,
    };
  const anchor =
    [...plans, prepared]
      .filter((p) => p.start < start)
      .sort((a, b) => b.start.localeCompare(a.start))[0] ?? prepared;
  const stage = expected.stage;
  let plan = developedPlan(
    {
      weekNumber: stage,
      start,
      easyPace: anchor.easyPace,
      tempoPace: anchor.tempoPace,
      targetKm: volumeMilestones[stage - 1],
    },
    athlete,
    plans,
    {
      eligible: false,
      level: anchor.development?.qualityLevel ?? 0,
      referenceStart: null,
    },
  );
  if (plan.development) {
    const level = forecastTempoLevel(
      anchor.weekNumber,
      anchor.development?.qualityLevel ?? 0,
      stage,
    );
    plan = createTrainingPlan(
      stage,
      start,
      anchor.easyPace,
      anchor.tempoPace,
      volumeMilestones[stage - 1],
      {
        ...plan.development,
        qualityLevel: level,
        qualityForecast: true,
        reason:
          "Conditional tempo forecast: assumes repeated well-tolerated training at each level. Weekly approval rechecks actual running, recovery, races and breaks; this is not an approved progression or a faster-pace forecast.",
      },
    );
  }
  const distributed =
    start <= dayOffsetDate(monday, 7)
      ? distributeMileage(plan, context.longestRecentKm ?? 0)
      : plan;
  return {
    plan: distributed ?? plan,
    kind: correction ? ("correction" as const) : ("projection" as const),
  };
}
export function attendanceForWeek(
  start: string,
  weeks: Record<string, WeekPreferences>,
  preparedStart: string,
  prepared: WeekPreferences,
) {
  if (weeks[start]) return weeks[start];
  const previous = Object.keys(weeks)
    .filter((w) => w < start)
    .sort()
    .at(-1);
  return previous && previous >= preparedStart ? weeks[previous] : prepared;
}

// Deep links carry only a validated calendar day, never an instruction to save a plan.
export function planDayHref(day: string) {
  weekMonday(day);
  return `/plan?date=${encodeURIComponent(day)}`;
}
export function planDayFromQuery(raw: string | null, min: string, max: string) {
  if (!raw) return undefined;
  try {
    const start = weekMonday(raw);
    return start >= min && start <= max ? raw : undefined;
  } catch {
    return undefined;
  }
}
