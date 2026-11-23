import type Database from "better-sqlite3";
import { saveWorkoutReview } from "./workout-reviews";
import { captureUpcomingWorkouts } from "./review-capture";

// Matching/feedback can change automatic recovery immediately. Capture the
// resulting upcoming prescription versions in the same transaction.
export function updateWorkoutReview(
  db: Database.Database,
  input: unknown,
  now = new Date(),
) {
  db.transaction(() => {
    saveWorkoutReview(db, input, now);
    captureUpcomingWorkouts(db, now, "change");
  }).immediate();
}
