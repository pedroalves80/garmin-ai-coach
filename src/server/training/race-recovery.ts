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
  const sync = prepare(
    db,
    "SELECT last_completed_at FROM sync_state WHERE provider='garmin'",
  ).get() as { last_completed_at: string | null } | undefined;
  const syncAge = now.getTime() - Date.parse(sync?.last_completed_at ?? "");
  // Optional activity, not clearance: a recent sync and no known concerns are
  // required. Reports remain optional; unknown symptoms must be checked before riding.
  const cyclingAllowed =
    Number.isFinite(syncAge) &&
    syncAge >= 0 &&
    syncAge <= 2 * 86400000 &&
    !pain &&
    !reports.some((c) => c.fatigue >= 3 || c.soreness >= 3) &&
    recovery.status !== "caution";
  return {
    cyclingAllowed,
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
