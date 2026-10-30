import type Database from "better-sqlite3";
import { z } from "zod";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_WEEK_PREFERENCES,
  type TrainingPreferences,
  type WeekPreferences,
  type ScheduleChange,
} from "../../shared/types/schedule";
import { dayOffsetDate } from "../../shared/weekly-schedule";

export const preferencesSchema = z
  .object({
    ftpWatts: z.number().int().min(40).max(700),
    weekdayCyclingMinutes: z.number().int().min(15).max(1440),
    saturdayCyclingMinutes: z.number().int().min(15).max(1440),
    automaticCoach: z.boolean(),
  })
  .strict();
const attendance = z.enum(["going", "skipping", "undecided"]);
export const weekPreferencesSchema = z
  .object({
    hyrox: z
      .object({ monday: attendance, wednesday: attendance, friday: attendance })
      .strict(),
    cyclingDays: z
      .array(z.number().int().min(0).max(5))
      .max(6)
      .refine((days) => new Set(days).size === days.length),
    cycleWhenSkippingHyrox: z.boolean(),
  })
  .strict();
export class ScheduleRepository {
  constructor(private db: Database.Database) {}
  preferences(): TrainingPreferences {
    const row = this.db
      .prepare("SELECT settings_json FROM training_preferences WHERE id=1")
      .get() as { settings_json: string } | undefined;
    return row
      ? preferencesSchema.parse(JSON.parse(row.settings_json))
      : { ...DEFAULT_PREFERENCES };
  }
  savePreferences(preferences: TrainingPreferences) {
    this.db
      .prepare(
        "INSERT INTO training_preferences(id,settings_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json",
      )
      .run(JSON.stringify(preferencesSchema.parse(preferences)));
  }
  week(start: string): WeekPreferences {
    const row = this.db
      .prepare("SELECT settings_json FROM week_preferences WHERE week_start=?")
      .get(start) as { settings_json: string } | undefined;
    return row
      ? weekPreferencesSchema.parse(JSON.parse(row.settings_json))
      : structuredClone(DEFAULT_WEEK_PREFERENCES);
  }
  weeks(): Record<string, WeekPreferences> {
    const rows = this.db
      .prepare(
        "SELECT week_start,settings_json FROM week_preferences ORDER BY week_start DESC LIMIT 52",
      )
      .all() as { week_start: string; settings_json: string }[];
    return Object.fromEntries(
      rows.map((row) => [
        row.week_start,
        weekPreferencesSchema.parse(JSON.parse(row.settings_json)),
      ]),
    );
  }
  saveWeek(start: string, week: WeekPreferences) {
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO week_preferences(week_start,settings_json) VALUES(?,?) ON CONFLICT(week_start) DO UPDATE SET settings_json=excluded.settings_json",
        )
        .run(start, JSON.stringify(weekPreferencesSchema.parse(week)));
    })();
  }
  changes(start: string): ScheduleChange[] {
    return (
      this.db
        .prepare(
          "SELECT day,sessions_json FROM day_schedule_overrides WHERE day>=? AND day<? ORDER BY day",
        )
        .all(start, dayOffsetDate(start, 7)) as {
        day: string;
        sessions_json: string;
      }[]
    ).map((r) => ({ day: r.day, sessions: JSON.parse(r.sessions_json) }));
  }
  saveChanges(changes: ScheduleChange[], reviewId: string | null) {
    for (const change of changes)
      this.db
        .prepare(
          "INSERT INTO day_schedule_overrides(day,sessions_json,review_id) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET sessions_json=excluded.sessions_json,review_id=excluded.review_id",
        )
        .run(change.day, JSON.stringify(change.sessions), reviewId);
  }
}
