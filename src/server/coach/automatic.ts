import type Database from "better-sqlite3";
import { coachContext } from "./context";
import { ScheduleRepository } from "../training/schedule-repository";
import type { CoachService } from "./service";

// Persistent daily claim prevents duplicate spend across worker restarts/replicas.
export class AutomaticCoach {
  constructor(
    private db: Database.Database,
    private service: CoachService,
    private configured: boolean,
    private now = () => new Date(),
  ) {}
  async tick() {
    if (
      !this.configured ||
      !new ScheduleRepository(this.db).preferences().automaticCoach
    )
      return "disabled";
    const now = this.now(),
      context = coachContext(this.db, now);
    if (!context.plan || !context.canSchedule) return "waiting";
    const status = this.service.status(true);
    if (
      status.dailyUsed >= status.dailyLimit ||
      status.monthlyUsed >= status.monthlyLimit
    )
      return "limited";
    if (
      this.db
        .prepare(
          "SELECT id FROM coach_requests WHERE finished=0 AND created_at>? LIMIT 1",
        )
        .get(new Date(now.getTime() - 60000).toISOString())
    )
      return "waiting";
    const claimed = this.db
      .prepare(
        "INSERT OR IGNORE INTO automatic_coach(day,context_hash,attempted_at,error) VALUES(?,?,?,NULL)",
      )
      .run(context.day, context.hash, now.toISOString());
    if (!claimed.changes) return "done";
    try {
      await this.service.review("today");
      return "reviewed";
    } catch {
      this.db
        .prepare("UPDATE automatic_coach SET error=? WHERE day=?")
        .run(
          "Automatic review unavailable. Check Coach for request limits and configuration; request a new review manually if needed.",
          context.day,
        );
      return "failed";
    }
  }
}
