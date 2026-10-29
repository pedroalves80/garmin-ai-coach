import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrateDatabase } from "./migrate";

let sqlite: Database.Database | undefined;

export function getDatabase(): Database.Database {
  if (sqlite) return sqlite;
  const databasePath = process.env.DATABASE_PATH ?? "./data/coach.db";
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  migrateDatabase(sqlite);
  return sqlite;
}
