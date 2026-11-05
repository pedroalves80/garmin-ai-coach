import type { RunWorkout } from "./metrics";

export type HyroxAttendance = "going" | "skipping" | "undecided";
export type WeekPreferences = {
  hyrox: {
    monday: HyroxAttendance;
    wednesday: HyroxAttendance;
    friday: HyroxAttendance;
  };
  cyclingDays: number[];
  cycleWhenSkippingHyrox: boolean;
};
export type TrainingPreferences = {
  ftpWatts: number;
  weekdayCyclingMinutes: number;
  saturdayCyclingMinutes: number;
  automaticCoach: boolean;
};
export type PowerStep = {
  name: "Warm Up" | "Ride" | "Cool Down";
  minutes: number;
  minPercent: number;
  maxPercent: number;
};
export type CyclingWorkout = {
  title: string;
  effort: "recovery" | "endurance";
  ftpWatts: number;
  steps: PowerStep[];
};
export type TrainingSession = (
  | { sport: "running"; workout: RunWorkout }
  | { sport: "cycling"; workout: CyclingWorkout }
  | { sport: "hyrox"; minutes: number; attendance: HyroxAttendance }
) & { id?: string; slot: "morning" | "lunch" | "later" | "event" };
export type SessionState = {
  session: TrainingSession;
  status: "planned" | "recorded" | "blocked";
};
export type ScheduledDay = {
  day: string;
  dayOffset: number;
  sessions: SessionState[];
  recorded: { sport: string; minutes: number; km: number }[];
  warnings: string[];
  rule?: import("./commitments").CalendarRule;
  race?: import("./commitments").RaceEvent;
  unavailableSlots?: ("morning" | "lunch" | "later")[];
};
export type ScheduleChange = { day: string; sessions: TrainingSession[] };
export type WeekSchedule = { start: string; days: ScheduledDay[] };
export const MINIMUM_CYCLING_MINUTES = 60;
export const DEFAULT_PREFERENCES: TrainingPreferences = {
  ftpWatts: 176,
  weekdayCyclingMinutes: MINIMUM_CYCLING_MINUTES,
  saturdayCyclingMinutes: 90,
  automaticCoach: true,
};
export const DEFAULT_WEEK_PREFERENCES: WeekPreferences = {
  hyrox: { monday: "going", wednesday: "going", friday: "undecided" },
  cyclingDays: [1, 3, 5],
  cycleWhenSkippingHyrox: true,
};
export const WEEKDAY_LUNCH_MINUTES = 120;
export const MAX_DAILY_WORKOUTS = 2;
