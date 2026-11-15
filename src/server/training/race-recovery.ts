import type Database from "better-sqlite3";
import { prepare } from "../db/statements";
import { TrainingRepository } from "./repository";
import { calendarDate, shiftDay } from "./dates";
import { garminRecovery, type HealthEvidenceRow } from "./recovery";

// Reports are optional. Missing symptoms or wearable coverage never mean clearance.
export function raceRecoveryEvidence(db: Database.Database, now: Date) {
  const today = calendarDate(now);
  const reports = new TrainingRepository(db)
    .checkIns()
    .filter((c) => c.day >= shiftDay(today, -2) && c.day <= today);
  const pain = reports.some((c) => c.pain > 0);
  const fatigue = reports.some((c) => c.fatigue >= 4 || c.soreness >= 4);
  const rows = prepare(
    db,
    "SELECT day,resting_heart_rate AS restingHeartRate,sleep_seconds AS sleepSeconds FROM daily_health WHERE day>=? AND day<=? ORDER BY day",
  ).all(shiftDay(today, -28), today) as HealthEvidenceRow[];
  const recovery = garminRecovery(rows, today);
  return {
    stopRunning: pain || fatigue,
    reasons: [
      ...(pain
        ? [
            "Recent pain is reported: withhold post-race running and review recovery before resuming.",
          ]
        : []),
      ...(fatigue
        ? [
            "Recent high fatigue or soreness is reported: withhold post-race running rather than forcing distance.",
          ]
        : []),
      ...(recovery.status === "caution"
        ? [
            "Recent Garmin sleep/resting-HR flags support a temporary distance reduction; review symptoms and recovery before doing more.",
          ]
        : []),
    ],
  };
}
