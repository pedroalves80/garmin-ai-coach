import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const syncState = sqliteTable("sync_state", {
  provider: text("provider").primaryKey(),
  lastStartedAt: text("last_started_at"),
  lastCompletedAt: text("last_completed_at"),
  lastError: text("last_error"),
  updatedAt: text("updated_at").notNull(),
});

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  providerActivityId: text("provider_activity_id").notNull().unique(),
  sportType: text("sport_type").notNull(),
  name: text("name"),
  startedAt: text("started_at").notNull(),
  durationSeconds: integer("duration_seconds"),
  distanceMeters: real("distance_meters"),
  averageHeartRate: integer("average_heart_rate"),
  maxHeartRate: integer("max_heart_rate"),
  rawJson: text("raw_json").notNull(),
  importedAt: text("imported_at").notNull(),
});

export const dailyHealth = sqliteTable("daily_health", {
  id: text("id").primaryKey(),
  day: text("day").notNull().unique(),
  sleepSeconds: integer("sleep_seconds"),
  restingHeartRate: integer("resting_heart_rate"),
  bodyBattery: integer("body_battery"),
  rawJson: text("raw_json").notNull(),
  importedAt: text("imported_at").notNull(),
});

export const dailyCheckIns = sqliteTable("daily_check_ins", {
  day: text("day").primaryKey(),
  fatigue: integer("fatigue").notNull(),
  soreness: integer("soreness").notNull(),
  pain: integer("pain").notNull(),
  notes: text("notes").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const trainingPlans = sqliteTable("training_plans", {
  weekStart: text("week_start").primaryKey(),
  planJson: text("plan_json").notNull(),
  createdAt: text("created_at").notNull(),
});
