import type Database from "better-sqlite3";

export function migrateDatabase(sqlite: Database.Database) {
  sqlite.transaction(() => {
    sqlite.exec(`
  CREATE TABLE IF NOT EXISTS sync_state (
    provider TEXT PRIMARY KEY,
    last_started_at TEXT,
    last_completed_at TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    provider_activity_id TEXT NOT NULL UNIQUE,
    sport_type TEXT NOT NULL,
    name TEXT,
    started_at TEXT NOT NULL,
    duration_seconds INTEGER,
    distance_meters REAL,
    average_heart_rate INTEGER,
    max_heart_rate INTEGER,
    raw_json TEXT NOT NULL,
    imported_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS daily_health (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL UNIQUE,
    sleep_seconds INTEGER,
    resting_heart_rate INTEGER,
    body_battery INTEGER,
    raw_json TEXT NOT NULL,
    imported_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_lock (
    provider TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_schedule (
    provider TEXT PRIMARY KEY,
    next_run_at TEXT NOT NULL,
    last_attempt_at TEXT,
    last_seen_sync TEXT,
    failures INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    worker_owner TEXT,
    worker_expires_at TEXT,
    heartbeat_at TEXT
  );
  CREATE INDEX IF NOT EXISTS activities_started_at_idx ON activities(started_at);
  CREATE TABLE IF NOT EXISTS daily_check_ins (
    day TEXT PRIMARY KEY,
    fatigue INTEGER NOT NULL CHECK(fatigue BETWEEN 1 AND 5),
    soreness INTEGER NOT NULL CHECK(soreness BETWEEN 1 AND 5),
    pain INTEGER NOT NULL CHECK(pain BETWEEN 0 AND 10),
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS training_plans (
    week_start TEXT PRIMARY KEY,
    plan_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coach_requests (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    created_at TEXT NOT NULL,
    finished INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS coach_requests_day_idx ON coach_requests(day);
  CREATE TABLE IF NOT EXISTS coach_reviews (
    id TEXT PRIMARY KEY,
    cache_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    review_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coach_overrides (
    day TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES coach_reviews(id),
    workout_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS training_preferences(id INTEGER PRIMARY KEY CHECK(id=1),settings_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS week_preferences(week_start TEXT PRIMARY KEY,settings_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS day_schedule_overrides(day TEXT PRIMARY KEY,sessions_json TEXT NOT NULL,review_id TEXT REFERENCES coach_reviews(id));
  CREATE TABLE IF NOT EXISTS training_availability(day TEXT PRIMARY KEY,slots_json TEXT NOT NULL,reason TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS schedule_edit_history(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,summary TEXT NOT NULL,reason TEXT,days_json TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,context_json TEXT NOT NULL,undone_at TEXT);
  CREATE INDEX IF NOT EXISTS schedule_edit_history_created_idx ON schedule_edit_history(created_at);
  CREATE TABLE IF NOT EXISTS weekly_planning(week_start TEXT PRIMARY KEY,evidence_hash TEXT NOT NULL,review_json TEXT,attempted_at TEXT NOT NULL,error TEXT,accepted_token TEXT,accepted_plan_hash TEXT);
  CREATE TABLE IF NOT EXISTS automatic_coach(day TEXT PRIMARY KEY,context_hash TEXT NOT NULL,attempted_at TEXT NOT NULL,error TEXT);
  CREATE TABLE IF NOT EXISTS race_pace_evidence(id TEXT PRIMARY KEY,day TEXT NOT NULL,source TEXT NOT NULL,distance_km REAL NOT NULL,seconds INTEGER NOT NULL,updated_at TEXT NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS race_pace_evidence_reference_idx ON race_pace_evidence(day,source,distance_km);
  CREATE TABLE IF NOT EXISTS race_events(id TEXT PRIMARY KEY,day TEXT NOT NULL,item_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS training_pauses(id TEXT PRIMARY KEY,start TEXT NOT NULL,item_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS activity_mileage(activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,race_id TEXT REFERENCES race_events(id),excluded_meters REAL NOT NULL CHECK(excluded_meters>=0),updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS workout_prescriptions(id TEXT PRIMARY KEY,session_key TEXT NOT NULL,planned_day TEXT NOT NULL,captured_at TEXT NOT NULL,workout_json TEXT,easy_pace INTEGER NOT NULL,plan_start TEXT NOT NULL,source TEXT NOT NULL,signature TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS workout_prescriptions_session_idx ON workout_prescriptions(session_key,captured_at);
  CREATE INDEX IF NOT EXISTS workout_prescriptions_day_idx ON workout_prescriptions(planned_day);
  CREATE TABLE IF NOT EXISTS prescription_current(session_key TEXT PRIMARY KEY,snapshot_id TEXT NOT NULL REFERENCES workout_prescriptions(id));
  CREATE TABLE IF NOT EXISTS activity_prescription_links(activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,snapshot_id TEXT UNIQUE REFERENCES workout_prescriptions(id),updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS activity_feedback(activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,feeling TEXT NOT NULL CHECK(feeling IN ('easier','right','harder')),updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS activity_details(activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,activity_fingerprint TEXT NOT NULL,summary_json TEXT,workouts_json TEXT,fetched_at TEXT NOT NULL,status TEXT NOT NULL,next_attempt_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS fitness_evidence(id TEXT PRIMARY KEY,kind TEXT NOT NULL,observed_on TEXT,data_json TEXT NOT NULL,reported_at TEXT NOT NULL,archived_at TEXT);
  CREATE TABLE IF NOT EXISTS planning_policy(id INTEGER PRIMARY KEY CHECK(id=1),policy_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS athlete_profile(id INTEGER PRIMARY KEY CHECK(id=1),profile_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS session_efforts(activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,rpe INTEGER NOT NULL CHECK(rpe BETWEEN 1 AND 10),prescription_completed INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
`);
    const effortColumns = sqlite
      .prepare("PRAGMA table_info(session_efforts)")
      .all() as { name: string }[];
    if (
      !effortColumns.some((column) => column.name === "prescription_completed")
    )
      sqlite.exec(
        "ALTER TABLE session_efforts ADD COLUMN prescription_completed INTEGER NOT NULL DEFAULT 0",
      );
  })();
}
