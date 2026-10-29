import type Database from "better-sqlite3";

export function migrateDatabase(sqlite: Database.Database) {
  sqlite.transaction(() =>
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
`),
  )();
}
