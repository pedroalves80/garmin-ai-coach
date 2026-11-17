import {
  uniqueIndex,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const syncState = sqliteTable("sync_state", {
  provider: text("provider").primaryKey(),
  lastStartedAt: text("last_started_at"),
  lastCompletedAt: text("last_completed_at"),
  lastError: text("last_error"),
  updatedAt: text("updated_at").notNull(),
});

export const syncSchedule = sqliteTable("sync_schedule", {
  provider: text("provider").primaryKey(),
  nextRunAt: text("next_run_at").notNull(),
  lastAttemptAt: text("last_attempt_at"),
  lastSeenSync: text("last_seen_sync"),
  failures: integer("failures").notNull().default(0),
  lastError: text("last_error"),
  workerOwner: text("worker_owner"),
  workerExpiresAt: text("worker_expires_at"),
  heartbeatAt: text("heartbeat_at"),
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

export const coachRequests = sqliteTable("coach_requests", {
  id: text("id").primaryKey(),
  day: text("day").notNull(),
  createdAt: text("created_at").notNull(),
  finished: integer("finished").notNull().default(0),
});
export const coachReviews = sqliteTable("coach_reviews", {
  id: text("id").primaryKey(),
  cacheKey: text("cache_key").notNull().unique(),
  createdAt: text("created_at").notNull(),
  reviewJson: text("review_json").notNull(),
});
export const coachOverrides = sqliteTable("coach_overrides", {
  day: text("day").primaryKey(),
  reviewId: text("review_id")
    .notNull()
    .references(() => coachReviews.id),
  workoutJson: text("workout_json").notNull(),
  createdAt: text("created_at").notNull(),
});
export const trainingPreferences = sqliteTable("training_preferences", {
  id: integer("id").primaryKey(),
  settingsJson: text("settings_json").notNull(),
});
export const weekPreferences = sqliteTable("week_preferences", {
  weekStart: text("week_start").primaryKey(),
  settingsJson: text("settings_json").notNull(),
});
export const dayScheduleOverrides = sqliteTable("day_schedule_overrides", {
  day: text("day").primaryKey(),
  sessionsJson: text("sessions_json").notNull(),
  reviewId: text("review_id").references(() => coachReviews.id),
});
export const automaticCoach = sqliteTable("automatic_coach", {
  day: text("day").primaryKey(),
  contextHash: text("context_hash").notNull(),
  attemptedAt: text("attempted_at").notNull(),
  error: text("error"),
});
export const athleteProfile = sqliteTable("athlete_profile", {
  id: integer("id").primaryKey(),
  profileJson: text("profile_json").notNull(),
});
export const sessionEfforts = sqliteTable("session_efforts", {
  activityId: text("activity_id")
    .primaryKey()
    .references(() => activities.id, { onDelete: "cascade" }),
  rpe: integer("rpe").notNull(),
  prescriptionCompleted: integer("prescription_completed", { mode: "boolean" })
    .notNull()
    .default(false),
  updatedAt: text("updated_at").notNull(),
});

export const raceEvents = sqliteTable("race_events", {
  id: text("id").primaryKey(),
  day: text("day").notNull(),
  itemJson: text("item_json").notNull(),
});
export const trainingPauses = sqliteTable("training_pauses", {
  id: text("id").primaryKey(),
  start: text("start").notNull(),
  itemJson: text("item_json").notNull(),
});

export const trainingAvailability = sqliteTable("training_availability", {
  day: text("day").primaryKey(),
  slotsJson: text("slots_json").notNull(),
  reason: text("reason").notNull(),
});
export const scheduleEditHistory = sqliteTable("schedule_edit_history", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  summary: text("summary").notNull(),
  reason: text("reason"),
  daysJson: text("days_json").notNull(),
  beforeJson: text("before_json").notNull(),
  afterJson: text("after_json").notNull(),
  contextJson: text("context_json").notNull(),
  undoneAt: text("undone_at"),
});

export const weeklyPlanning = sqliteTable("weekly_planning", {
  weekStart: text("week_start").primaryKey(),
  evidenceHash: text("evidence_hash").notNull(),
  reviewJson: text("review_json"),
  attemptedAt: text("attempted_at").notNull(),
  error: text("error"),
  acceptedToken: text("accepted_token"),
  acceptedPlanHash: text("accepted_plan_hash"),
});

export const racePaceEvidence = sqliteTable(
  "race_pace_evidence",
  {
    id: text("id").primaryKey(),
    day: text("day").notNull(),
    source: text("source").notNull(),
    distanceKm: real("distance_km").notNull(),
    seconds: integer("seconds").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("race_pace_evidence_reference_idx").on(
      t.day,
      t.source,
      t.distanceKm,
    ),
  ],
);

export const workoutPrescriptions = sqliteTable("workout_prescriptions", {
  id: text("id").primaryKey(),
  sessionKey: text("session_key").notNull(),
  plannedDay: text("planned_day").notNull(),
  capturedAt: text("captured_at").notNull(),
  workoutJson: text("workout_json"),
  easyPace: integer("easy_pace").notNull(),
  planStart: text("plan_start").notNull(),
  source: text("source").notNull(),
  signature: text("signature").notNull(),
});
export const prescriptionCurrent = sqliteTable("prescription_current", {
  sessionKey: text("session_key").primaryKey(),
  snapshotId: text("snapshot_id")
    .notNull()
    .references(() => workoutPrescriptions.id),
});
export const activityPrescriptionLinks = sqliteTable(
  "activity_prescription_links",
  {
    activityId: text("activity_id")
      .primaryKey()
      .references(() => activities.id, { onDelete: "cascade" }),
    snapshotId: text("snapshot_id")
      .unique()
      .references(() => workoutPrescriptions.id),
    updatedAt: text("updated_at").notNull(),
  },
);
export const activityFeedback = sqliteTable("activity_feedback", {
  activityId: text("activity_id")
    .primaryKey()
    .references(() => activities.id, { onDelete: "cascade" }),
  feeling: text("feeling").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const activityDetails = sqliteTable("activity_details", {
  activityId: text("activity_id")
    .primaryKey()
    .references(() => activities.id, { onDelete: "cascade" }),
  activityFingerprint: text("activity_fingerprint").notNull(),
  summaryJson: text("summary_json"),
  workoutsJson: text("workouts_json"),
  fetchedAt: text("fetched_at").notNull(),
  status: text("status").notNull(),
  nextAttemptAt: text("next_attempt_at").notNull(),
});
export const fitnessEvidence = sqliteTable("fitness_evidence", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  observedOn: text("observed_on"),
  dataJson: text("data_json").notNull(),
  reportedAt: text("reported_at").notNull(),
  archivedAt: text("archived_at"),
});

export const planningPolicy = sqliteTable("planning_policy", {
  id: integer("id").primaryKey(),
  policyJson: text("policy_json").notNull(),
});
