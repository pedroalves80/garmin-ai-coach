import type Database from "better-sqlite3";
import { TrainingRepository } from "./repository";
import { GarminRepository } from "../db/garmin-repository";
import { trainingCalendar } from "./calendar";
import { recordPrescriptionCalendar } from "./prescription-snapshots";
import { calendarDate, shiftDay } from "./dates";
export function captureUpcomingWorkouts(
  db: Database.Database,
  now = new Date(),
  source: "change" | "observed" | "legacy" = "observed",
) {
  const activities = new GarminRepository(db).allActivities(),
    today = calendarDate(now);
  for (const p of new TrainingRepository(db)
    .plans()
    .filter(
      (p) => p.start <= shiftDay(today, 730) && shiftDay(p.start, 7) > today,
    )) {
    const calendar = trainingCalendar(db, p, activities, now);
    recordPrescriptionCalendar(
      db,
      { ...calendar, days: calendar.days.filter((d) => d.day >= today) },
      p.easyPace,
      now,
      source,
      p.start,
    );
  }
}

export function captureExistingPrescriptions(
  db: Database.Database,
  now = new Date(),
) {
  if (
    (
      db.prepare("SELECT count(*) n FROM workout_prescriptions").get() as {
        n: number;
      }
    ).n
  )
    return;
  const today = calendarDate(now);
  for (const p of new TrainingRepository(db)
    .plans()
    .filter(
      (p) => p.start >= shiftDay(today, -90) && p.start <= shiftDay(today, 730),
    )) {
    // Legacy baselines are explicitly labelled: never backdate them to an approval.
    recordPrescriptionCalendar(
      db,
      trainingCalendar(db, p, [], now),
      p.easyPace,
      now,
      "legacy",
      p.start,
    );
  }
}
