import type Database from "better-sqlite3";
import type {
  DailyCheckIn,
  TrainingPlan,
  RunWorkout,
} from "../../shared/types/metrics";
import { savedPlanSchema } from "./validation";
import { shiftDay } from "./dates";
import type { CoachReview } from "../../shared/types/coach";

export class TrainingRepository {
  constructor(private readonly sqlite: Database.Database) {}
  checkIns(): DailyCheckIn[] {
    return this.sqlite
      .prepare(
        "SELECT day,fatigue,soreness,pain,notes FROM daily_check_ins ORDER BY day DESC LIMIT 90",
      )
      .all() as DailyCheckIn[];
  }
  saveCheckIn(item: DailyCheckIn) {
    this.sqlite
      .prepare(
        "INSERT INTO daily_check_ins(day,fatigue,soreness,pain,notes,updated_at) VALUES (@day,@fatigue,@soreness,@pain,@notes,@updatedAt) ON CONFLICT(day) DO UPDATE SET fatigue=excluded.fatigue,soreness=excluded.soreness,pain=excluded.pain,notes=excluded.notes,updated_at=excluded.updated_at",
      )
      .run({ ...item, updatedAt: new Date().toISOString() });
  }
  plans(): TrainingPlan[] {
    const rows = this.sqlite
      .prepare(
        "SELECT plan_json FROM training_plans ORDER BY week_start DESC LIMIT 52",
      )
      .all() as { plan_json: string }[];
    return rows.map((row) => savedPlanSchema.parse(JSON.parse(row.plan_json)));
  }
  savePlan(plan: TrainingPlan) {
    this.sqlite.transaction(() => {
      // A newly reviewed week supersedes any daily edits to its previous snapshot.
      this.sqlite
        .prepare("DELETE FROM coach_overrides WHERE day>=? AND day<?")
        .run(plan.start, shiftDay(plan.start, 7));
      this.sqlite
        .prepare("DELETE FROM day_schedule_overrides WHERE day>=? AND day<?")
        .run(plan.start, shiftDay(plan.start, 7));
      this.sqlite
        .prepare(
          "INSERT INTO training_plans(week_start,plan_json,created_at) VALUES (?,?,?) ON CONFLICT(week_start) DO UPDATE SET plan_json=excluded.plan_json",
        )
        .run(plan.start, JSON.stringify(plan), new Date().toISOString());
    })();
  }
  overrides() {
    return (
      this.sqlite
        .prepare(
          "SELECT o.day,o.workout_json,r.review_json FROM coach_overrides o JOIN coach_reviews r ON r.id=o.review_id ORDER BY o.day DESC LIMIT 52",
        )
        .all() as { day: string; workout_json: string; review_json: string }[]
    ).map((row) => ({
      day: row.day,
      workout: JSON.parse(row.workout_json) as RunWorkout | null,
      before: (JSON.parse(row.review_json) as CoachReview).proposal!.before,
    }));
  }
}
