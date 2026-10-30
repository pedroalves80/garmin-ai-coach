import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { GarminRepository } from "../db/garmin-repository";
import { TrainingRepository } from "../training/repository";
import { calendarDate, mondayOf, shiftDay } from "../training/dates";
import { weeklyMetrics, comparableRuns, sportGroup } from "../training/metrics";
import { assessProgression } from "../training/progression";
import type { CoachAction, CoachKind } from "../../shared/types/coach";
import type { RunWorkout } from "../../shared/types/metrics";
import { minimumRunKm, workoutKm } from "../../shared/training-plan";

export function coachContext(sqlite: Database.Database, now: Date) {
  const day = calendarDate(now),
    monday = mondayOf(day);
  const garmin = new GarminRepository(sqlite);
  const training = new TrainingRepository(sqlite);
  const activities = garmin
    .allActivities()
    .filter((a) => Date.parse(a.startedAt) <= now.getTime());
  const plans = training.plans();
  const checkIns = training
    .checkIns()
    .filter((c) => c.day <= day && c.day >= shiftDay(day, -6));
  const plan = plans.find((p) => p.start === monday) ?? null;
  const workout =
    plan?.workouts.find((w) => shiftDay(plan.start, w.dayOffset) === day) ??
    null;
  const lastSync = garmin.status()?.lastCompletedAt ?? null;
  const weeks = weeklyMetrics(activities, now);
  const accepted = sqlite
    .prepare("SELECT review_id,workout_json FROM coach_overrides WHERE day=?")
    .get(day) as { review_id: string; workout_json: string } | undefined;
  const effectiveWorkout = accepted
    ? (JSON.parse(accepted.workout_json) as RunWorkout | null)
    : workout;
  const todayActivities = activities.filter(
    (a) => calendarDate(new Date(a.startedAt)) === day,
  );
  const ranToday = todayActivities.some((a) => sportGroup(a) === "running");
  const todayCheckIn = checkIns.find((c) => c.day === day) ?? null;
  const pain = checkIns.some((c) => c.day >= shiftDay(day, -2) && c.pain > 0);
  const stale =
    !lastSync || now.getTime() - Date.parse(lastSync) > 2 * 86400000;
  const constraints: string[] = [];
  let allowed: CoachAction[] = ["follow", "shorten", "easy", "rest"];
  if (pain) {
    allowed = ["rest"];
    constraints.push(
      "Recent pain reported: pause running and assess it before resuming. Persistent or worsening pain needs professional assessment.",
    );
  } else if (!workout || ranToday || accepted) {
    allowed =
      accepted && effectiveWorkout && !ranToday
        ? ["follow", "rest"]
        : ["follow"];
    constraints.push(
      ranToday
        ? "A run is already recorded today. Do not add another run."
        : accepted
          ? "Today's adjustment is already approved: follow the adjusted workout or rest; do not restore quality or distance."
          : "No saved run today. Save a reviewed plan before requesting workout changes.",
    );
  } else if (stale || !todayCheckIn) {
    allowed = ["follow", "rest"];
    constraints.push(
      stale
        ? "Sync Garmin before changing today's workout; the training data is missing or over two days old."
        : "Log today's check-in before adjusting the workout.",
    );
  } else if (todayCheckIn.fatigue >= 4 || todayCheckIn.soreness >= 4) {
    allowed = ["shorten", "rest"];
    constraints.push(
      "High fatigue or soreness: reduce today's run or rest; no quality work.",
    );
  }
  if (workout && plan) {
    const km = workoutKm(workout, plan.easyPace);
    if (km <= minimumRunKm + 1e-8 && allowed.includes("shorten")) {
      allowed = allowed.filter((action) => action !== "shorten");
      constraints.push(
        "This run is already at the 5 km minimum. Choose rest rather than shortening it below that distance.",
      );
    }
    if (km < minimumRunKm - 1e-8)
      allowed = allowed.filter((action) => action !== "easy");
  }
  const health = sqlite
    .prepare(
      "SELECT day,sleep_seconds AS sleepSeconds,resting_heart_rate AS restingHeartRate,body_battery AS bodyBattery FROM daily_health WHERE day BETWEEN ? AND ? ORDER BY day",
    )
    .all(shiftDay(day, -6), day);
  // Explicit allowlist: never send raw activity JSON, locations, names, notes or credentials.
  const payload = {
    day,
    workoutPreferences: { stepTarget: "distance", minimumRunKm },
    lastSync,
    schedule:
      "Mon run + Hyrox; Tue run + cycling; Wed Hyrox; Thu run + cycling; Fri optional Hyrox; Sat long run + cycling; Sun rest. Saved plans may add runs at later stages.",
    weeks: weeks.map((w) =>
      Object.fromEntries(
        Object.entries(w).map(([k, v]) => [
          k,
          typeof v === "number" ? Math.round(v * 10) / 10 : v,
        ]),
      ),
    ),
    recentDays: Array.from({ length: 7 }, (_, i) => {
      const date = shiftDay(day, i - 6);
      const rows = activities.filter(
        (a) => calendarDate(new Date(a.startedAt)) === date,
      );
      return {
        day: date,
        sessions: rows
          .map((a) => ({
            sport: sportGroup(a),
            minutes: Math.round((a.durationSeconds ?? 0) / 60),
            km: Math.round((a.distanceMeters ?? 0) / 100) / 10,
            averageHeartRate: a.averageHeartRate,
          }))
          .slice(0, 8),
      };
    }),
    health,
    checkIns: checkIns.map(({ day, fatigue, soreness, pain }) => ({
      day,
      fatigue,
      soreness,
      pain,
    })),
    plan: plan
      ? {
          weekNumber: plan.weekNumber,
          start: plan.start,
          targetKm: plan.targetKm,
          cutback: plan.cutback,
        }
      : null,
    todayWorkout: effectiveWorkout
      ? { type: effectiveWorkout.type, steps: effectiveWorkout.steps }
      : null,
    ranToday,
    acceptedReview: accepted?.review_id ?? null,
    comparison: comparableRuns(activities, now),
    progression: assessProgression({
      now,
      plans,
      weeks,
      checkIns,
      activities,
      lastSync,
    }),
    constraints,
    allowedActions: allowed,
  };
  // The private plan fingerprint also invalidates approvals when another day is edited.
  const hash = createHash("sha256")
    .update(JSON.stringify({ payload, plan }))
    .digest("hex");
  return {
    payload,
    hash,
    plan,
    workout,
    day,
    allowed,
    constraints,
    canAdjust:
      !!workout &&
      !!effectiveWorkout &&
      !ranToday &&
      !stale &&
      (!!todayCheckIn || pain),
  };
}
export type CoachData = ReturnType<typeof coachContext>;
export function allowedActions(
  context: CoachData,
  kind: CoachKind,
): CoachAction[] {
  return kind === "weekly" ? ["follow"] : context.allowed;
}
