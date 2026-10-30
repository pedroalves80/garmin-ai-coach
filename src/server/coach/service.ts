import { randomUUID, createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  CoachKind,
  CoachReview,
  CoachStatus,
} from "../../shared/types/coach";
import { calendarDate } from "../training/dates";
import { coachContext, allowedActions } from "./context";
import { workoutProposal, scheduleProposal } from "./policy";
import { ScheduleRepository } from "../training/schedule-repository";
import { PROMPT_VERSION, reviewOutput, type CoachAdapter } from "./openai";

export class CoachError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export class CoachService {
  constructor(
    private db: Database.Database,
    private adapter: CoachAdapter,
    private model: string,
    private now = () => new Date(),
  ) {}
  status(configured: boolean): CoachStatus {
    const day = calendarDate(this.now());
    const count = (prefix: string) =>
      (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM coach_requests WHERE day LIKE ?")
          .get(`${prefix}%`) as { n: number }
      ).n;
    const reviews = (
      this.db
        .prepare(
          "SELECT review_json FROM coach_reviews ORDER BY created_at DESC LIMIT 8",
        )
        .all() as { review_json: string }[]
    ).map((row) => JSON.parse(row.review_json) as CoachReview);
    const accepted = this.db
      .prepare(
        "SELECT day,review_id AS reviewId FROM day_schedule_overrides WHERE day=? UNION ALL SELECT day,review_id AS reviewId FROM coach_overrides WHERE day=? AND NOT EXISTS(SELECT 1 FROM day_schedule_overrides WHERE day=?) LIMIT 1",
      )
      .get(day, day, day) as CoachStatus["accepted"] | undefined;
    const automatic = this.db
      .prepare("SELECT attempted_at,error FROM automatic_coach WHERE day=?")
      .get(day) as { attempted_at: string; error: string | null } | undefined;
    return {
      configured,
      model: this.model,
      dailyUsed: count(day),
      monthlyUsed: count(day.slice(0, 7)),
      dailyLimit: 6,
      monthlyLimit: 60,
      reviews,
      accepted: accepted?.reviewId ? accepted : null,
      automatic: {
        enabled: new ScheduleRepository(this.db).preferences().automaticCoach,
        attemptedAt: automatic?.attempted_at ?? null,
        error: automatic?.error ?? null,
      },
    };
  }
  async review(kind: CoachKind) {
    const now = this.now(),
      context = coachContext(this.db, now);
    const key = createHash("sha256")
      .update([kind, this.model, PROMPT_VERSION, context.hash].join(":"))
      .digest("hex");
    const cached = this.db
      .prepare("SELECT review_json FROM coach_reviews WHERE cache_key=?")
      .get(key) as { review_json: string } | undefined;
    if (cached)
      return {
        review: JSON.parse(cached.review_json) as CoachReview,
        cached: true,
      };
    const id = randomUUID();
    this.db
      .transaction(() => {
        const status = this.status(true);
        if (
          status.dailyUsed >= status.dailyLimit ||
          status.monthlyUsed >= status.monthlyLimit
        )
          throw new CoachError(
            "Coach request limit reached. Cached reviews remain available; try again after the next daily or monthly reset (Europe/Lisbon).",
            429,
          );
        const pending = this.db
          .prepare(
            "SELECT id FROM coach_requests WHERE finished=0 AND created_at>? LIMIT 1",
          )
          .get(new Date(now.getTime() - 60000).toISOString());
        if (pending)
          throw new CoachError(
            "A coach review is already running. Please wait for it to finish.",
            409,
          );
        this.db
          .prepare(
            "INSERT INTO coach_requests(id,day,created_at,finished) VALUES(?,?,?,0)",
          )
          .run(id, context.day, now.toISOString());
      })
      .immediate();
    try {
      const result = await this.adapter({
        kind,
        context: context.payload,
        allowed: allowedActions(context, kind),
      });
      const output = reviewOutput.parse(result.output);
      const proposal = workoutProposal(context, kind, output.action);
      const scheduleChanges = scheduleProposal(context, kind, output.action);
      const review: CoachReview = {
        id,
        kind,
        day: context.day,
        createdAt: now.toISOString(),
        model: this.model,
        contextHash: context.hash,
        ...output,
        constraints: context.constraints,
        proposal,
        scheduleChanges,
        usage: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      };
      this.db
        .prepare(
          "INSERT INTO coach_reviews(id,cache_key,created_at,review_json) VALUES(?,?,?,?)",
        )
        .run(id, key, now.toISOString(), JSON.stringify(review));
      return { review, cached: false };
    } catch (error) {
      if (error instanceof CoachError) throw error;
      // Never return provider responses, credentials, raw health data or stack traces.
      throw new CoachError(
        "The AI review could not be completed. Check the server's OpenAI key, model access and API billing, then try again. No workout was changed.",
        502,
      );
    } finally {
      this.db
        .prepare("UPDATE coach_requests SET finished=1 WHERE id=?")
        .run(id);
    }
  }
  accept(id: string) {
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare("SELECT review_json FROM coach_reviews WHERE id=?")
          .get(id) as { review_json: string } | undefined;
        if (!row) throw new CoachError("Review not found.", 404);
        const review = JSON.parse(row.review_json) as CoachReview;
        const existing = this.db
          .prepare(
            "SELECT review_id FROM day_schedule_overrides WHERE day=? UNION ALL SELECT review_id FROM coach_overrides WHERE day=? AND NOT EXISTS(SELECT 1 FROM day_schedule_overrides WHERE day=?) LIMIT 1",
          )
          .get(review.day, review.day, review.day) as
          { review_id: string } | undefined;
        if (existing?.review_id === id) return { saved: true };
        const context = coachContext(this.db, this.now());
        if (context.day !== review.day || context.hash !== review.contextHash)
          throw new CoachError(
            "Training data changed since this review. Request a new review before approving it.",
            409,
          );
        if (
          review.kind !== "today" ||
          (!review.proposal && !review.scheduleChanges?.length)
        )
          throw new CoachError("This review has no workout change to approve.");
        const proposal = workoutProposal(context, review.kind, review.action);
        const changes = scheduleProposal(context, review.kind, review.action);
        if (
          review.scheduleChanges &&
          JSON.stringify(changes) !== JSON.stringify(review.scheduleChanges)
        )
          throw new CoachError(
            "This schedule changed. Request a new review.",
            409,
          );
        if (!proposal && !changes.length)
          throw new CoachError("This change is no longer available.", 409);
        if (changes.length)
          new ScheduleRepository(this.db).saveChanges(changes, id);
        if (proposal)
          this.db
            .prepare(
              "INSERT INTO coach_overrides(day,review_id,workout_json,created_at) VALUES(?,?,?,?) ON CONFLICT(day) DO UPDATE SET review_id=excluded.review_id,workout_json=excluded.workout_json,created_at=excluded.created_at",
            )
            .run(
              context.day,
              id,
              JSON.stringify(proposal.after),
              this.now().toISOString(),
            );
        return { saved: true };
      })
      .immediate();
  }
}
