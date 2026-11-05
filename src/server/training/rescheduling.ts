import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type {
  AvailabilityBlock,
  ScheduleEdit,
  ScheduleEditCatalog,
  ScheduleEditHistory,
  ScheduleEditPreview,
  TrainingSlot,
} from "../../shared/types/rescheduling";
import type {
  ScheduleChange,
  TrainingSession,
  WeekSchedule,
} from "../../shared/types/schedule";
import type { TrainingPlan } from "../../shared/types/metrics";
import {
  editableSession,
  relocatedSession,
  sessionIdentity,
  recoveryWarnings,
} from "../../shared/schedule-editing";
import {
  isDistanceWorkout,
  minimumRunKm,
  workoutKm,
} from "../../shared/training-plan";
import { reviewPlannedWeek } from "../../shared/planned-load";
import {
  ScheduleRuleError,
  validateDaySessions,
} from "../../shared/weekly-schedule";
import { GarminRepository } from "../db/garmin-repository";
import { TrainingRepository } from "./repository";
import { ScheduleRepository } from "./schedule-repository";
import { AthleteRepository } from "./athlete-repository";
import { CommitmentRepository } from "./commitment-repository";
import { trainingCalendar } from "./calendar";
import { calendarDate, mondayOf, shiftDay } from "./dates";
import { measuredLoad, combinedLoadReview } from "./load";

const slot = z.enum(["morning", "lunch", "later"]);
const reason = z.enum(["unavailable", "tired", "other"]);
const sessionId = z.string().min(1).max(180);
const source = { day: z.iso.date(), sessionId, reason };
export const scheduleEditSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("move"),
      ...source,
      toDay: z.iso.date(),
      toSlot: slot,
    })
    .strict(),
  z
    .object({
      action: z.literal("swap"),
      ...source,
      withDay: z.iso.date(),
      withSessionId: sessionId,
    })
    .strict(),
  z.object({ action: z.literal("skip"), ...source }).strict(),
  z
    .object({
      action: z.literal("availability"),
      day: z.iso.date(),
      slots: z
        .array(slot)
        .max(3)
        .refine((s) => new Set(s).size === s.length),
      reason,
    })
    .strict(),
  z.object({ action: z.literal("undo"), id: z.uuid() }).strict(),
]);
export class ScheduleEditError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function title(session: TrainingSession) {
  return session.sport === "hyrox" ? "Hyrox class" : session.workout.title;
}
function km(calendar: WeekSchedule, plan: TrainingPlan) {
  return calendar.days.reduce(
    (n, d) =>
      n +
      d.sessions.reduce(
        (sum, s) =>
          sum +
          (s.session.sport === "running"
            ? workoutKm(s.session.workout, plan.easyPace)
            : 0),
        0,
      ),
    0,
  );
}
type OverrideRow = {
  day: string;
  sessions_json: string;
  review_id: string | null;
};
type AvailabilityRow = { day: string; slots_json: string; reason: string };
type Snapshot = { overrides: OverrideRow[]; availability: AvailabilityRow[] };
type HistoryRow = {
  id: string;
  created_at: string;
  summary: string;
  reason: ScheduleEditHistory["reason"];
  days_json: string;
  before_json: string;
  after_json: string;
  context_json: string;
  undone_at: string | null;
};
type Prepared = {
  preview: ScheduleEditPreview;
  changes: ScheduleChange[];
  availability?: AvailabilityBlock;
  restore?: Snapshot;
  undoId?: string;
};

export class ScheduleEditingService {
  private readonly schedule: ScheduleRepository;
  private readonly training: TrainingRepository;
  private readonly garmin: GarminRepository;
  constructor(
    private readonly db: Database.Database,
    private readonly now = new Date(),
  ) {
    this.schedule = new ScheduleRepository(db);
    this.training = new TrainingRepository(db);
    this.garmin = new GarminRepository(db);
  }
  private activities() {
    return this.garmin
      .allActivities()
      .filter((a) => Date.parse(a.startedAt) <= this.now.getTime());
  }
  private stateHash() {
    return hash({
      today: calendarDate(this.now),
      plans: this.training.plans(),
      schedule: this.schedule.revisionData(),
      preferences: this.schedule.preferences(),
      weeks: this.schedule.weeks(),
      legacy: this.db
        .prepare("SELECT * FROM coach_overrides ORDER BY day")
        .all(),
      commitments: new CommitmentRepository(this.db).all(),
      athlete: new AthleteRepository(this.db).profile(),
      efforts: new AthleteRepository(this.db).efforts(),
      checkIns: this.training.checkIns(),
      activities: this.activities(),
      lastSync: this.garmin.status()?.lastCompletedAt,
      health: this.db
        .prepare("SELECT * FROM daily_health ORDER BY day DESC LIMIT 7")
        .all(),
    });
  }
  private snapshot(days: string[]): Snapshot {
    const overrides: OverrideRow[] = [],
      availability: AvailabilityRow[] = [];
    for (const day of days) {
      const o = this.db
        .prepare("SELECT * FROM day_schedule_overrides WHERE day=?")
        .get(day) as OverrideRow | undefined;
      const a = this.db
        .prepare("SELECT * FROM training_availability WHERE day=?")
        .get(day) as AvailabilityRow | undefined;
      if (o) overrides.push(o);
      if (a) availability.push(a);
    }
    return { overrides, availability };
  }
  private restore(days: string[], snapshot: Snapshot) {
    for (const day of days) {
      this.db
        .prepare("DELETE FROM day_schedule_overrides WHERE day=?")
        .run(day);
      this.db.prepare("DELETE FROM training_availability WHERE day=?").run(day);
    }
    for (const row of snapshot.overrides)
      this.db
        .prepare(
          "INSERT INTO day_schedule_overrides(day,sessions_json,review_id) VALUES(?,?,?)",
        )
        .run(row.day, row.sessions_json, row.review_id);
    for (const row of snapshot.availability)
      this.db
        .prepare(
          "INSERT INTO training_availability(day,slots_json,reason) VALUES(?,?,?)",
        )
        .run(row.day, row.slots_json, row.reason);
  }
  private undoContext(days: string[]) {
    const starts = new Set(days.map(mondayOf));
    return hash({
      plans: this.training.plans().filter((p) => starts.has(p.start)),
      weeks: [...starts].sort().map((start) => this.schedule.week(start)),
      preferences: this.schedule.preferences(),
      commitments: new CommitmentRepository(this.db).all(),
      athlete: new AthleteRepository(this.db).profile(),
      checkIns: this.training.checkIns(),
      efforts: new AthleteRepository(this.db).efforts(),
      legacy: this.db
        .prepare("SELECT * FROM coach_overrides ORDER BY day")
        .all(),
      activities: this.activities().filter((a) =>
        days.includes(calendarDate(new Date(a.startedAt))),
      ),
    });
  }
  private undoProblem(row: HistoryRow): string | null {
    if (row.undone_at) return "Already undone.";
    const days: string[] = JSON.parse(row.days_json);
    if (days.some((d) => d < calendarDate(this.now)))
      return "Affected dates are now in history.";
    if (hash(this.snapshot(days)) !== hash(JSON.parse(row.after_json)))
      return "The affected schedule was changed again.";
    if (this.undoContext(days) !== row.context_json)
      return "Activities, commitments or the reviewed week changed. Review the current schedule instead.";
    return null;
  }
  private historyRows(): HistoryRow[] {
    return this.db
      .prepare(
        "SELECT * FROM schedule_edit_history ORDER BY rowid DESC LIMIT 30",
      )
      .all() as HistoryRow[];
  }
  catalog(week: string): ScheduleEditCatalog {
    const today = calendarDate(this.now),
      monday = mondayOf(today);
    this.checkDate(week, false);
    if (mondayOf(week) !== week)
      throw new ScheduleEditError("Choose a Monday.");
    const plans = this.training
      .plans()
      .filter(
        (p) =>
          p.start >= shiftDay(week, -7) &&
          p.start <= shiftDay(week, 7) &&
          p.start >= monday,
      );
    const activities = this.activities(),
      days = plans
        .sort((a, b) => a.start.localeCompare(b.start))
        .flatMap(
          (plan) => trainingCalendar(this.db, plan, activities, this.now).days,
        );
    return {
      today,
      days,
      availability: this.schedule.availability(),
      easyPaces: Object.fromEntries(
        days.map((d) => [
          d.day,
          plans.find((p) => p.start === mondayOf(d.day))!.easyPace,
        ]),
      ),
      history: this.historyRows().map((row) => {
        const problem = this.undoProblem(row);
        return {
          id: row.id,
          createdAt: row.created_at,
          summary: row.summary,
          reason: row.reason,
          days: JSON.parse(row.days_json),
          undoneAt: row.undone_at,
          canUndo: !problem,
          undoReason: problem,
        };
      }),
    };
  }
  private checkDate(day: string, upcoming = true) {
    const today = calendarDate(this.now);
    if (
      day < (upcoming ? today : mondayOf(today)) ||
      day > shiftDay(today, 730)
    )
      throw new ScheduleEditError(
        "Choose today or an upcoming date within two years. Past sessions stay in history.",
      );
  }
  private planFor(day: string) {
    const plan = this.training.plans().find((p) => p.start === mondayOf(day));
    if (!plan)
      throw new ScheduleEditError(
        "Save a reviewed week for this date before changing its workouts.",
      );
    return plan;
  }
  private prepare(raw: unknown): Prepared {
    const request = scheduleEditSchema.parse(raw) as ScheduleEdit;
    const activities = this.activities(),
      allPlans = this.training.plans(),
      today = calendarDate(this.now);
    const changes: ScheduleChange[] = [];
    let availability: AvailabilityBlock | undefined,
      restore: Snapshot | undefined,
      undoId: string | undefined;
    let summary: string, affected: string[];
    const read = (day: string, canonical = false) => {
      const plan = this.planFor(day);
      return trainingCalendar(this.db, plan, activities, this.now, undefined, {
        canonical,
      }).days.find((d) => d.day === day)!;
    };
    if (request.action === "undo") {
      const row = this.db
        .prepare("SELECT * FROM schedule_edit_history WHERE id=?")
        .get(request.id) as HistoryRow | undefined;
      if (!row) throw new ScheduleEditError("Change not found.", 404);
      const problem = this.undoProblem(row);
      if (problem) throw new ScheduleEditError(`Cannot undo: ${problem}`, 409);
      affected = JSON.parse(row.days_json);
      restore = JSON.parse(row.before_json);
      undoId = row.id;
      summary = `Undo: ${row.summary}`;
    } else if (request.action === "availability") {
      this.checkDate(request.day);
      affected = [request.day];
      const slots = (["morning", "lunch", "later"] as TrainingSlot[]).filter(
        (s) => request.slots.includes(s),
      );
      availability = { day: request.day, slots, reason: request.reason };
      summary =
        slots.length === 3
          ? `${request.day}: unavailable all day`
          : slots.length
            ? `${request.day}: unavailable ${slots.join(" / ")}`
            : `${request.day}: clear unavailable windows`;
      const old =
        this.schedule.availability().find((b) => b.day === request.day)
          ?.slots ?? [];
      if (hash(old) === hash(slots))
        throw new ScheduleEditError("Availability is already set this way.");
    } else {
      this.checkDate(request.day);
      const source = read(request.day),
        canonicalSource = read(request.day, true);
      const entry = editableSession(
        source,
        request.sessionId,
        today,
        request.action === "skip",
      );
      const id = sessionIdentity(entry.session, source.day);
      const original = canonicalSource.sessions.find(
        (s) => sessionIdentity(s.session, source.day) === id,
      );
      if (!original)
        throw new ScheduleEditError(
          "This session is controlled by a calendar rule. Review that commitment instead.",
        );
      if (request.action === "skip") {
        affected = [source.day];
        changes.push({
          day: source.day,
          sessions: canonicalSource.sessions
            .filter((s) => sessionIdentity(s.session, source.day) !== id)
            .map((s) => s.session),
        });
        summary = `Skip ${title(entry.session)} on ${source.day}`;
      } else {
        const destination =
          request.action === "move" ? request.toDay : request.withDay;
        this.checkDate(destination);
        const target = read(destination),
          canonicalTarget = read(destination, true);
        const check = this.training.checkIns().find((c) => c.day === today);
        if (
          this.training
            .checkIns()
            .some(
              (c) =>
                c.day >= shiftDay(today, -2) && c.day <= today && c.pain > 0,
            )
        )
          throw new ScheduleEditError(
            "Recent pain is recorded. Review recovery with the coach or use a training break before moving workouts.",
          );
        if (check && (check.fatigue >= 4 || check.soreness >= 4))
          throw new ScheduleEditError(
            "High fatigue or soreness is recorded. Review a reduction or rest with the coach instead of moving training.",
          );
        const targetPlan = this.planFor(destination);
        if (request.action === "move") {
          if (
            source.day === target.day &&
            entry.session.slot === request.toSlot
          )
            throw new ScheduleEditError(
              "Choose a different date or training window.",
            );
          const moved = relocatedSession(
            original,
            source,
            target,
            request.toSlot,
            targetPlan.easyPace,
            today,
          );
          affected = [...new Set([source.day, target.day])].sort();
          const remainingSource = canonicalSource.sessions
            .filter((s) => sessionIdentity(s.session, source.day) !== id)
            .map((s) => s.session);
          changes.push({
            day: source.day,
            sessions:
              source.day === target.day
                ? [...remainingSource, moved]
                : remainingSource,
          });
          if (target.day !== source.day)
            changes.push({
              day: target.day,
              sessions: [
                ...canonicalTarget.sessions.map((s) => s.session),
                moved,
              ],
            });
          summary = `Move ${title(entry.session)}: ${source.day} → ${target.day} ${request.toSlot}`;
        } else {
          if (source.day === target.day)
            throw new ScheduleEditError(
              "Choose a session on another date to swap.",
            );
          const other = editableSession(target, request.withSessionId, today);
          const otherOriginal = canonicalTarget.sessions.find(
            (s) =>
              sessionIdentity(s.session, target.day) === request.withSessionId,
          );
          if (
            !otherOriginal ||
            other.session.slot === "event" ||
            entry.session.slot === "event"
          )
            throw new ScheduleEditError("Fixed events cannot be swapped.");
          const moved = relocatedSession(
            original,
            source,
            target,
            other.session.slot,
            targetPlan.easyPace,
            today,
            request.withSessionId,
          );
          const movedOther = relocatedSession(
            otherOriginal,
            target,
            source,
            entry.session.slot,
            this.planFor(source.day).easyPace,
            today,
            id,
          );
          affected = [source.day, target.day].sort();
          changes.push(
            {
              day: source.day,
              sessions: [
                ...canonicalSource.sessions
                  .filter((s) => sessionIdentity(s.session, source.day) !== id)
                  .map((s) => s.session),
                movedOther,
              ],
            },
            {
              day: target.day,
              sessions: [
                ...canonicalTarget.sessions
                  .filter(
                    (s) =>
                      sessionIdentity(s.session, target.day) !==
                      request.withSessionId,
                  )
                  .map((s) => s.session),
                moved,
              ],
            },
          );
          summary = `Swap ${title(entry.session)} (${source.day}) ↔ ${title(other.session)} (${target.day})`;
        }
      }
    }
    const starts = [...new Set(affected.map(mondayOf))];
    const blocks = this.schedule
      .availability()
      .filter(
        (b) =>
          b.day !== availability?.day && !(restore && affected.includes(b.day)),
      );
    if (availability?.slots.length) blocks.push(availability);
    if (restore)
      blocks.push(
        ...restore.availability.map((row) => ({
          day: row.day,
          slots: JSON.parse(row.slots_json),
          reason: row.reason as AvailabilityBlock["reason"],
        })),
      );
    let previewChanges = changes;
    if (restore) {
      // A missing override must expose the canonical baseline, including legacy coach changes.
      previewChanges = affected.flatMap((day) => {
        if (!allPlans.some((p) => p.start === mondayOf(day))) return [];
        const saved = restore!.overrides.find((o) => o.day === day);
        if (saved)
          return [
            {
              day,
              sessions: JSON.parse(saved.sessions_json) as TrainingSession[],
            },
          ];
        const plan = this.planFor(day);
        const canonical = trainingCalendar(
          this.db,
          plan,
          activities,
          this.now,
          undefined,
          { canonical: true, ignoreOverrides: [day] },
        )
          .days.find((d) => d.day === day)!
          .sessions.map((s) => s.session);
        return [{ day, sessions: canonical }];
      });
    }
    const before = new Map<string, WeekSchedule>(),
      after = new Map<string, WeekSchedule>();
    // Include adjacent saved weeks for recovery checks across Sunday, not just edited dates.
    const relevant = allPlans.filter((p) =>
      starts.some(
        (start) =>
          p.start >= shiftDay(start, -7) && p.start <= shiftDay(start, 7),
      ),
    );
    const warnings: string[] = [];
    const load = combinedLoadReview(
      measuredLoad(
        activities,
        new AthleteRepository(this.db).efforts(),
        this.now,
      ),
    );
    for (const plan of relevant) {
      const current = trainingCalendar(this.db, plan, activities, this.now);
      const next = trainingCalendar(
        this.db,
        plan,
        activities,
        this.now,
        undefined,
        { changes: previewChanges, availability: blocks },
      );
      before.set(plan.start, current);
      after.set(plan.start, next);
      if (starts.includes(plan.start)) {
        const changedDays = next.days.filter((d) => affected.includes(d.day));
        const added = changedDays.flatMap((d) =>
          d.sessions.filter(
            (s) =>
              s.status !== "recorded" &&
              !current.days
                .find((old) => old.day === d.day)
                ?.sessions.some(
                  (old) =>
                    sessionIdentity(old.session, d.day) ===
                    sessionIdentity(s.session, d.day),
                ),
          ),
        );
        if (added.length) {
          const checks = this.training.checkIns(),
            check = checks.find((c) => c.day === today);
          if (
            checks.some(
              (c) =>
                c.day >= shiftDay(today, -2) && c.day <= today && c.pain > 0,
            ) ||
            (check && (check.fatigue >= 4 || check.soreness >= 4))
          )
            throw new ScheduleEditError(
              "Current recovery reports require review. Use the coach or a training break before restoring or moving workouts.",
            );
        }
        const countType = (cal: WeekSchedule, type: string) =>
          cal.days
            .flatMap((d) => d.sessions)
            .filter(
              (s) =>
                s.session.sport === "running" &&
                s.session.workout.type === type,
            ).length;
        for (const type of ["quality", "strides", "long"]) {
          if (
            countType(next, type) >
            Math.max(
              countType(current, type),
              plan.workouts.filter((w) => w.type === type).length,
            )
          )
            throw new ScheduleEditError(
              "This change adds a key running session beyond the destination week's review. Swap equivalent workouts or review the week first.",
            );
        }
        for (const day of changedDays) {
          validateDaySessions(
            day.dayOffset,
            day.sessions.map((s) => s.session),
            plan.easyPace,
            day.race,
          );
          if (day.sessions.some((s) => s.status === "blocked"))
            throw new ScheduleEditError(
              "This change would exceed the daily session limit.",
            );
          for (const entry of day.sessions)
            if (
              entry.status !== "recorded" &&
              entry.session.sport === "running" &&
              !entry.session.workout.race &&
              (!isDistanceWorkout(entry.session.workout) ||
                workoutKm(entry.session.workout, plan.easyPace) <
                  minimumRunKm - 1e-8)
            )
              throw new ScheduleEditError(
                "Training runs require distance steps totaling at least 5 km.",
              );
          warnings.push(...day.warnings);
        }
        const projected = (cal: WeekSchedule) =>
          cal.days.reduce(
            (sum, d) =>
              sum +
              Math.max(
                d.recorded
                  .filter((r) => r.sport === "running")
                  .reduce((n, r) => n + r.km, 0),
                d.sessions
                  .filter(
                    (s) =>
                      s.status === "recorded" && s.session.sport === "running",
                  )
                  .reduce(
                    (n, s) =>
                      n +
                      (s.session.sport === "running"
                        ? workoutKm(s.session.workout, plan.easyPace)
                        : 0),
                    0,
                  ),
              ) +
              d.sessions
                .filter(
                  (s) =>
                    s.status !== "recorded" && s.session.sport === "running",
                )
                .reduce(
                  (n, s) =>
                    n +
                    (s.session.sport === "running"
                      ? workoutKm(s.session.workout, plan.easyPace)
                      : 0),
                  0,
                ),
            0,
          );
        if (
          projected(next) >
          Math.max(projected(current), plan.targetKm) + 0.02
        )
          throw new ScheduleEditError(
            "This move exceeds the destination week's reviewed running volume. Swap runs or review that week first; missed kilometres are not automatically added.",
          );
      }
      const oldWarnings = reviewPlannedWeek(current, plan, load).warnings;
      warnings.push(
        ...reviewPlannedWeek(next, plan, load).warnings.filter(
          (w) =>
            !oldWarnings.includes(w) &&
            !w.includes("quality running precedes another key run") &&
            !w.includes("a demanding secondary session precedes a key run"),
        ),
      );
    }
    for (const change of changes) {
      const target = after
        .get(mondayOf(change.day))
        ?.days.find((d) => d.day === change.day);
      for (const session of change.sessions) {
        const wasThere = read(change.day, true).sessions.some(
          (s) =>
            sessionIdentity(s.session, change.day) ===
            sessionIdentity(session, change.day),
        );
        if (
          !wasThere &&
          !target?.sessions.some(
            (s) =>
              sessionIdentity(s.session, change.day) ===
              sessionIdentity(session, change.day),
          )
        )
          throw new ScheduleEditError(
            "A race, break, recovery or availability rule would suppress the moved session. Choose another date.",
          );
      }
    }
    warnings.push(
      ...recoveryWarnings(
        [...after.values()].flatMap((c) => c.days),
        affected,
      ),
    );
    if (request.action !== "undo" && request.reason === "tired")
      warnings.push(
        "You selected tired. Recheck recovery before the moved session; postponing it does not resolve fatigue.",
      );
    if (request.action === "skip" || request.action === "availability")
      warnings.push(
        "Removed distance is not redistributed. The reviewed progression baseline is unchanged.",
      );
    warnings.push(
      "Garmin Connect workouts are not rescheduled automatically. Use the updated day and existing step targets when scheduling them in Garmin.",
    );
    const days = affected.map((day) => ({
      day,
      before:
        before.get(mondayOf(day))?.days.find((d) => d.day === day)?.sessions ??
        [],
      after:
        after.get(mondayOf(day))?.days.find((d) => d.day === day)?.sessions ??
        [],
      beforeUnavailable:
        this.schedule.availability().find((b) => b.day === day)?.slots ?? [],
      afterUnavailable: blocks.find((b) => b.day === day)?.slots ?? [],
    }));
    return {
      changes,
      availability,
      restore,
      undoId,
      preview: {
        request,
        revision: hash({ state: this.stateHash(), request }),
        summary,
        days,
        weeks: starts.flatMap((start) => {
          const plan = allPlans.find((p) => p.start === start);
          return plan
            ? [
                {
                  start,
                  beforeKm: km(before.get(start)!, plan),
                  afterKm: km(after.get(start)!, plan),
                },
              ]
            : [];
        }),
        warnings: [...new Set(warnings)],
      },
    };
  }
  preview(input: unknown) {
    return this.db.transaction(() => this.prepare(input).preview)();
  }
  apply(input: unknown, revision: string) {
    return this.db
      .transaction(() => {
        const prepared = this.prepare(input);
        if (prepared.preview.revision !== revision)
          throw new ScheduleEditError(
            "Training data changed after the preview. Preview again before applying.",
            409,
          );
        const days = prepared.preview.days.map((d) => d.day),
          before = this.snapshot(days);
        if (prepared.restore) this.restore(days, prepared.restore);
        else {
          this.schedule.saveChanges(prepared.changes, null);
          if (prepared.availability)
            this.schedule.saveAvailability(prepared.availability);
        }
        const id = randomUUID(),
          stamp = this.now.toISOString();
        if (prepared.undoId)
          this.db
            .prepare("UPDATE schedule_edit_history SET undone_at=? WHERE id=?")
            .run(stamp, prepared.undoId);
        this.db
          .prepare(
            "INSERT INTO schedule_edit_history(id,created_at,summary,reason,days_json,before_json,after_json,context_json,undone_at) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            stamp,
            prepared.preview.summary,
            prepared.preview.request.action === "undo"
              ? null
              : prepared.preview.request.reason,
            JSON.stringify(days),
            JSON.stringify(before),
            JSON.stringify(this.snapshot(days)),
            this.undoContext(days),
            prepared.undoId ? stamp : null,
          );
        return { saved: true, id };
      })
      .immediate();
  }
  suggest(
    day: string,
    sessionId: string,
    reason: "unavailable" | "tired" | "other",
  ) {
    const catalog = this.catalog(mondayOf(day));
    const candidates: ScheduleEditPreview[] = [];
    for (const target of catalog.days.filter(
      (d) => d.day > day && d.dayOffset < 6,
    ))
      for (const toSlot of ["morning", "lunch", "later"] as TrainingSlot[]) {
        try {
          candidates.push(
            this.preview({
              action: "move",
              day,
              sessionId,
              toDay: target.day,
              toSlot,
              reason,
            }),
          );
        } catch (error) {
          if (
            !(error instanceof ScheduleRuleError) &&
            !(error instanceof ScheduleEditError)
          )
            throw error;
        }
      }
    const score = (p: ScheduleEditPreview) =>
      p.warnings.filter((w) => !w.startsWith("Garmin Connect")).length;
    candidates.sort(
      (a, b) =>
        score(a) - score(b) ||
        (a.request.action === "move" && b.request.action === "move"
          ? a.request.toDay.localeCompare(b.request.toDay)
          : 0),
    );
    if (!candidates.length)
      throw new ScheduleEditError(
        "No suitable free date fits the reviewed weeks. Try a swap, skip this session or review the remaining week; no catch-up distance has been added.",
      );
    return candidates[0];
  }
}
