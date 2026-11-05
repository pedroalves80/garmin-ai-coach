import { prepare } from "../db/statements";
import type { AvailabilityBlock } from "../../shared/types/rescheduling";
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  DEFAULT_PREFERENCES,
  MINIMUM_CYCLING_MINUTES,
  DEFAULT_WEEK_PREFERENCES,
  type TrainingPreferences,
  type WeekPreferences,
  type ScheduleChange,
} from "../../shared/types/schedule";
import { dayOffsetDate } from "../../shared/weekly-schedule";

export const preferencesSchema = z
  .object({
    ftpWatts: z.number().int().min(40).max(700),
    weekdayCyclingMinutes: z
      .number()
      .int()
      .min(MINIMUM_CYCLING_MINUTES)
      .max(1440),
    saturdayCyclingMinutes: z
      .number()
      .int()
      .min(MINIMUM_CYCLING_MINUTES)
      .max(1440),
    automaticCoach: z.boolean(),
  })
  .strict();
// Older installations allowed shorter rides; retain all other saved preferences.
const storedPreferencesSchema = preferencesSchema.extend({
  weekdayCyclingMinutes: z.number().int().min(15).max(1440),
  saturdayCyclingMinutes: z.number().int().min(15).max(1440),
});
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
  availability(): AvailabilityBlock[] {
    return (
      prepare(
        this.db,
        "SELECT day,slots_json,reason FROM training_availability ORDER BY day",
      ).all() as {
        day: string;
        slots_json: string;
        reason: AvailabilityBlock["reason"];
      }[]
    ).map((row) => ({
      day: row.day,
      slots: JSON.parse(row.slots_json),
      reason: row.reason,
    }));
  }
  saveAvailability(block: AvailabilityBlock) {
    if (!block.slots.length)
      prepare(this.db, "DELETE FROM training_availability WHERE day=?").run(
        block.day,
      );
    else
      prepare(
        this.db,
        "INSERT INTO training_availability(day,slots_json,reason) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET slots_json=excluded.slots_json,reason=excluded.reason",
      ).run(block.day, JSON.stringify(block.slots), block.reason);
  }
  revisionData() {
    return {
      overrides: prepare(
        this.db,
        "SELECT day,sessions_json,review_id FROM day_schedule_overrides ORDER BY day",
      ).all(),
      availability: this.availability(),
      edits: prepare(
        this.db,
        "SELECT id,undone_at FROM schedule_edit_history ORDER BY created_at,id",
      ).all(),
    };
  }
  preferences(): TrainingPreferences {
    const row = prepare(
      this.db,
      "SELECT settings_json FROM training_preferences WHERE id=1",
    ).get() as { settings_json: string } | undefined;
    if (!row) return { ...DEFAULT_PREFERENCES };
    const saved = storedPreferencesSchema.parse(JSON.parse(row.settings_json));
    return {
      ...saved,
      weekdayCyclingMinutes: Math.max(
        MINIMUM_CYCLING_MINUTES,
        saved.weekdayCyclingMinutes,
      ),
      saturdayCyclingMinutes: Math.max(
        MINIMUM_CYCLING_MINUTES,
        saved.saturdayCyclingMinutes,
      ),
    };
  }
  savePreferences(preferences: TrainingPreferences) {
    prepare(
      this.db,
      "INSERT INTO training_preferences(id,settings_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json",
    ).run(JSON.stringify(preferencesSchema.parse(preferences)));
  }
  week(start: string): WeekPreferences {
    const row = prepare(
      this.db,
      "SELECT settings_json FROM week_preferences WHERE week_start=?",
    ).get(start) as { settings_json: string } | undefined;
    return row
      ? weekPreferencesSchema.parse(JSON.parse(row.settings_json))
      : structuredClone(DEFAULT_WEEK_PREFERENCES);
  }
  weeks(): Record<string, WeekPreferences> {
    const rows = prepare(
      this.db,
      "SELECT week_start,settings_json FROM week_preferences ORDER BY week_start DESC LIMIT 156",
    ).all() as { week_start: string; settings_json: string }[];
    return Object.fromEntries(
      rows.map((row) => [
        row.week_start,
        weekPreferencesSchema.parse(JSON.parse(row.settings_json)),
      ]),
    );
  }
  saveWeek(start: string, week: WeekPreferences) {
    this.db.transaction(() => {
      prepare(
        this.db,
        "INSERT INTO week_preferences(week_start,settings_json) VALUES(?,?) ON CONFLICT(week_start) DO UPDATE SET settings_json=excluded.settings_json",
      ).run(start, JSON.stringify(weekPreferencesSchema.parse(week)));
    })();
  }
  changes(start: string): ScheduleChange[] {
    return (
      prepare(
        this.db,
        "SELECT day,sessions_json FROM day_schedule_overrides WHERE day>=? AND day<? ORDER BY day",
      ).all(start, dayOffsetDate(start, 7)) as {
        day: string;
        sessions_json: string;
      }[]
    ).map((r) => ({ day: r.day, sessions: JSON.parse(r.sessions_json) }));
  }
  saveChanges(changes: ScheduleChange[], reviewId: string | null) {
    for (const change of changes)
      prepare(
        this.db,
        "INSERT INTO day_schedule_overrides(day,sessions_json,review_id) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET sessions_json=excluded.sessions_json,review_id=excluded.review_id",
      ).run(change.day, JSON.stringify(change.sessions), reviewId);
  }
}
