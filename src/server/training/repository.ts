import type Database from "better-sqlite3";
import type { DailyCheckIn, TrainingPlan } from "../../shared/types/metrics";
import { savedPlanSchema } from "./validation";

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
    this.sqlite
      .prepare(
        "INSERT INTO training_plans(week_start,plan_json,created_at) VALUES (?,?,?) ON CONFLICT(week_start) DO UPDATE SET plan_json=excluded.plan_json",
      )
      .run(plan.start, JSON.stringify(plan), new Date().toISOString());
  }
}
