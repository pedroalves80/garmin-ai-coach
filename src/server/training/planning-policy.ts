import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_PLANNING_POLICY,
  trainingCycle,
  type PlanningPolicy,
} from "../../shared/training-cycle";
import { milestoneForWeek } from "../../shared/milestones";
import { TrainingRepository } from "./repository";
import { GarminRepository } from "../db/garmin-repository";
import { AthleteRepository } from "./athlete-repository";
import { CommitmentRepository } from "./commitment-repository";
import { calendarDate, mondayOf, shiftDay } from "./dates";
import { countedActivityKm } from "../../shared/mileage";
import { sportGroup } from "./metrics";
import { garminRecovery } from "./recovery";
import { calendarGate } from "../../shared/commitment-calendar";
import { measuredLoad, combinedLoadReview } from "./load";
import { tempoEvidence } from "./tempo-evidence";
const schema = z
  .object({
    ceilingKm: z.union([z.literal(80), z.literal(85), z.literal(90)]),
    effectiveFrom: z.iso.date().nullable(),
    reviewedAt: z.iso.datetime().nullable(),
  })
  .strict();
export function planningPolicy(db: Database.Database): PlanningPolicy {
  const row = db
    .prepare("SELECT policy_json FROM planning_policy WHERE id=1")
    .get() as { policy_json: string } | undefined;
  if (!row) return { ...DEFAULT_PLANNING_POLICY };
  try {
    const p = schema.parse(JSON.parse(row.policy_json));
    if (p.ceilingKm > 80 && (!p.effectiveFrom || !p.reviewedAt))
      return { ...DEFAULT_PLANNING_POLICY };
    return p;
  } catch {
    return { ...DEFAULT_PLANNING_POLICY };
  }
}
export class PlanningPolicyError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export const policyInput = z
  .object({
    ceilingKm: z.union([z.literal(80), z.literal(85), z.literal(90)]),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export function planningPolicyReview(
  db: Database.Database,
  ceilingKm: 80 | 85 | 90 = 80,
  now = new Date(),
) {
  const current = planningPolicy(db),
    today = calendarDate(now),
    monday = mondayOf(today),
    plans = new TrainingRepository(db).plans();
  const next = shiftDay(monday, 7),
    lastApproved = plans
      .filter((p) => p.start >= monday && p.start <= next)
      .sort((a, b) => b.start.localeCompare(a.start))[0];
  const effectiveFrom = lastApproved ? shiftDay(lastApproved.start, 7) : next;
  const stage = milestoneForWeek(monday, plans).stage;
  const activities = new GarminRepository(db)
    .allActivities()
    .filter((a) => Date.parse(a.startedAt) <= now.getTime());
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const start = shiftDay(monday, -7 * (i + 1));
    return {
      start,
      km: activities
        .filter(
          (a) =>
            sportGroup(a) === "running" &&
            calendarDate(new Date(a.startedAt)) >= start &&
            calendarDate(new Date(a.startedAt)) < shiftDay(start, 7),
        )
        .reduce((n, a) => n + countedActivityKm(a), 0),
    };
  });
  const baseline = current.ceilingKm;
  const establishedWeeks = weeks.filter((w) => {
    const p = plans.find((p) => p.start === w.start);
    return (
      p &&
      !p.development?.qualityForecast &&
      p.weekNumber >= 30 &&
      p.targetKm >= baseline * 0.9375 &&
      w.km >= baseline * 0.9375 &&
      w.km >= p.targetKm * 0.9 &&
      w.km <= p.targetKm * 1.15
    );
  });
  const established = establishedWeeks.length;
  const lastSync = new GarminRepository(db).status()?.lastCompletedAt;
  const health = db
    .prepare(
      "SELECT day,resting_heart_rate AS restingHeartRate,sleep_seconds AS sleepSeconds FROM daily_health WHERE day>=? AND day<=? ORDER BY day",
    )
    .all(shiftDay(today, -28), today) as {
    day: string;
    restingHeartRate: number | null;
    sleepSeconds: number | null;
  }[];
  const recovery = garminRecovery(health, today),
    checks = new TrainingRepository(db)
      .checkIns()
      .filter((c) => c.day >= shiftDay(today, -6) && c.day <= today);
  const load = combinedLoadReview(
    measuredLoad(activities, new AthleteRepository(db).efforts(), now),
  );
  const gate = calendarGate(new CommitmentRepository(db).all(), today, next);
  const feedback = tempoEvidence(db, now);
  const reasons: string[] = [];
  if (ceilingKm > current.ceilingKm) {
    const last = plans.find((p) => p.start === weeks[0].start);
    if (!last || weeks[0].km < last.targetKm * 0.9)
      reasons.push(
        "Complete the latest reviewed week before raising the ceiling; a gap does not establish current tolerance.",
      );
    if (stage <= 36)
      reasons.push(
        "Complete the build to 80 km and the six-week consolidation phase before reviewing a higher ceiling.",
      );
    if (
      established < 4 ||
      !establishedWeeks.some((w) => w.km >= baseline - 0.5)
    )
      reasons.push(
        `Establish at least four of the last six completed weeks near ${baseline} km, including a week at that ceiling. Current qualifying weeks: ${established}/4.`,
      );
    if (
      !lastSync ||
      Date.parse(lastSync) > now.getTime() ||
      now.getTime() - Date.parse(lastSync) > 2 * 86400000
    )
      reasons.push(
        "Sync recent Garmin data before reviewing a higher ceiling.",
      );
    if (
      recovery.status === "caution" ||
      checks.some((c) => c.pain > 0 || c.fatigue > 2 || c.soreness > 2)
    )
      reasons.push(
        "Recent recovery evidence calls for keeping or lowering the ceiling.",
      );
    else if (recovery.status !== "supportive" && !checks.length)
      reasons.push(
        "Recovery evidence is incomplete. Garmin coverage or an optional recent recovery report can support this review; daily reports are not required.",
      );
    if (
      load.latest.hardDays > 3 ||
      (load.change !== null && load.change > 0.15) ||
      feedback.harderRecently ||
      feedback.adverseRecently
    )
      reasons.push(
        "Recent effort or workout evidence needs review before raising the ceiling.",
      );
    if (gate.blocked) reasons.push(gate.reason);
  }
  const proposed: PlanningPolicy = {
    ceilingKm,
    effectiveFrom,
    reviewedAt: now.toISOString(),
  };
  const firstOngoing =
    stage < 37 ? shiftDay(monday, (37 - stage) * 7) : effectiveFrom;
  const previewStart =
    ceilingKm > 80
      ? firstOngoing > effectiveFrom
        ? firstOngoing
        : effectiveFrom
      : stage < 31
        ? shiftDay(monday, (31 - stage) * 7)
        : effectiveFrom;
  const forecastPolicy = {
    ...proposed,
    effectiveFrom: ceilingKm > 80 ? previewStart : effectiveFrom,
  };
  const preview = Array.from({ length: 8 }, (_, i) => {
    const start = shiftDay(previewStart, 7 * i),
      n = milestoneForWeek(start, plans).stage,
      c = trainingCycle(n, forecastPolicy, start);
    return { start, week: n, km: c.km, label: c.label, cutback: c.cutback };
  });
  const token = createHash("sha256")
    .update(
      JSON.stringify({
        current,
        ceilingKm,
        today,
        effectiveFrom,
        stage,
        weeks,
        lastSync,
        health,
        checks,
        load,
        gate,
        feedback,
        plans,
      }),
    )
    .digest("hex");
  return {
    current,
    proposed,
    token,
    eligible: !reasons.length,
    reasons,
    establishedWeeks: established,
    preview,
    note: "These are conditional weekly budgets, not a deadline or a guarantee of tolerance. Existing approved weeks stay exact; each new week still needs one approval. Supporting sessions are reviewed before adding running load.",
  };
}
export function savePlanningPolicy(
  db: Database.Database,
  input: unknown,
  now = new Date(),
) {
  const v = policyInput.parse(input);
  return db
    .transaction(() => {
      const review = planningPolicyReview(db, v.ceilingKm, now);
      if (review.token !== v.token)
        throw new PlanningPolicyError(
          "Training data changed. Review the ceiling again before applying it.",
        );
      if (!review.eligible) throw new PlanningPolicyError(review.reasons[0]);
      db.prepare(
        "INSERT INTO planning_policy(id,policy_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET policy_json=excluded.policy_json",
      ).run(JSON.stringify(review.proposed));
      return { saved: true, policy: review.proposed };
    })
    .immediate();
}
