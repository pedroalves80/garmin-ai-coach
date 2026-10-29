import { sqlite } from "@/server/db/client";

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
`);

console.log("Database migration complete");
