import { planningPolicy } from "../training/planning-policy";
import { trainingCycle } from "../../shared/training-cycle";
import { workoutReviewSummary } from "../training/workout-reviews";
import { fitnessEvidenceSummary } from "../training/fitness-evidence";
import { assessRaceRecoveries } from "../training/automatic-race-recovery";
import { racePacingData } from "../training/race-pacing";
import { racePacingContext } from "../../shared/race-pacing";
import { prepare } from "../db/statements";
import { garminRecovery } from "../training/recovery";
import { healthEvidence } from "../training/weekly-planning";
import { recoveryWarnings } from "../../shared/schedule-editing";
import { CommitmentRepository } from "../training/commitment-repository";
import { eventOnlyPlan, calendarGate } from "../../shared/commitment-calendar";
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
import { ScheduleRepository } from "../training/schedule-repository";
import {
  trainingCalendar,
  moveRunningDay,
  trainingEvidencePlans,
} from "../training/calendar";
import type { ScheduleChange } from "../../shared/types/schedule";
import { AthleteRepository } from "../training/athlete-repository";
import { measuredLoad, combinedLoadReview } from "../training/load";
import { reviewPlannedWeek } from "../../shared/planned-load";
import { developmentReadiness } from "../training/development";
import { MINIMUM_CYCLING_MINUTES } from "../../shared/types/schedule";

function raceSummary(r: import("../../shared/types/commitments").RaceEvent) {
  return {
    day: r.day,
    startTime: r.startTime,
    distanceKm: r.distanceKm,
    terrain: r.terrain,
    elevationGain: r.elevationGain,
    expectedMinutes: r.expectedMinutes,
    priority: r.priority,
    status: r.status,
    ...(r.recorded
      ? { recordedKm: r.recorded.km, recordedMinutes: r.recorded.minutes }
      : {}),
    ...(r.participationReview
      ? {
          participationReview:
            "controlled; follow prescribed recovery HR if valid",
        }
      : {}),
    ...(r.recoveryReview ? { baseReviewFrom: r.recoveryReview.from } : {}),
    ...(r.automaticRecovery
      ? {
          automaticRecovery: {
            status: r.automaticRecovery.status,
            checkedOn: r.automaticRecovery.checkedOn,
            qualifyingRunDays: r.automaticRecovery.recoveryRuns,
            healthDay: r.automaticRecovery.healthDay,
            paceComparison: r.automaticRecovery.paceComparison,
            reason: r.automaticRecovery.reasons[0],
          },
        }
      : {}),
  };
}
export function coachContext(sqlite: Database.Database, now: Date) {
  const day = calendarDate(now),
    monday = mondayOf(day);
  const recoveryEvidence = garminRecovery(healthEvidence(sqlite, day), day);
  const garmin = new GarminRepository(sqlite);
  const training = new TrainingRepository(sqlite);
  const activities = garmin
    .allActivities()
    .filter((a) => Date.parse(a.startedAt) <= now.getTime());
  const plans = training.plans();
  const checkIns = training
    .checkIns()
    .filter((c) => c.day <= day && c.day >= shiftDay(day, -6));
  const commitments = assessRaceRecoveries(
    sqlite,
    new CommitmentRepository(sqlite).all(),
    activities,
    now,
  );
  const plan =
    plans.find((p) => p.start === monday) ??
    (commitments.races.some(
      (r) =>
        r.status !== "cancelled" &&
        r.day >= monday &&
        r.day < shiftDay(monday, 7),
    )
      ? eventOnlyPlan(monday, 375, 270)
      : null);
  const originalWorkout =
    plan?.workouts.find((w) => shiftDay(plan.start, w.dayOffset) === day) ??
    null;
  const lastSync = garmin.status()?.lastCompletedAt ?? null;
  const weeks = weeklyMetrics(activities, now);
  const acceptedRow = prepare(
    sqlite,
    "SELECT review_id FROM day_schedule_overrides WHERE day=? UNION ALL SELECT review_id FROM coach_overrides WHERE day=? AND NOT EXISTS(SELECT 1 FROM day_schedule_overrides WHERE day=?) LIMIT 1",
  ).get(day, day, day) as { review_id: string | null } | undefined;
  const accepted = acceptedRow?.review_id
    ? { review_id: acceptedRow.review_id }
    : undefined;
  const athleteRepository = new AthleteRepository(sqlite),
    athlete = athleteRepository.profile(),
    efforts = athleteRepository.efforts();
  const load = combinedLoadReview(measuredLoad(activities, efforts, now));
  const development = developmentReadiness(
    athlete,
    trainingEvidencePlans(sqlite, plans, activities, now),
    activities,
    efforts,
    training.checkIns(),
    load,
    now,
    lastSync,
    recoveryEvidence,
  );
  const scheduleRepository = new ScheduleRepository(sqlite);
  const calendar = plan
    ? trainingCalendar(sqlite, plan, activities, now)
    : null;
  const todaySchedule = calendar?.days.find((d) => d.day === day) ?? null;
  const todayRun = todaySchedule?.sessions.find(
    (s) => s.session.sport === "running",
  )?.session;
  const workout: RunWorkout | null = todaySchedule
    ? todayRun?.sport === "running"
      ? todayRun.workout
      : null
    : originalWorkout;
  const effectiveWorkout = workout;
  const todayActivities = activities.filter(
    (a) => calendarDate(new Date(a.startedAt)) === day,
  );
  const ranToday = workout?.race
    ? (todaySchedule?.sessions.some(
        (s) => s.session.sport === "running" && s.status === "recorded",
      ) ?? false)
    : todayActivities.some((a) => sportGroup(a) === "running");
  const todayCheckIn = checkIns[0] ?? null;
  const recoveryAvailable =
    !!todayCheckIn || recoveryEvidence.status === "supportive";
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
          : plan
            ? "No run is scheduled today. Review supporting training without adding a run."
            : "Save a reviewed week before requesting workout changes.",
    );
  } else if (stale || !recoveryAvailable) {
    allowed = ["follow", "rest"];
    constraints.push(
      stale
        ? "Sync Garmin before changing today's workout; the training data is missing or over two days old."
        : "Daily check-ins are optional. With incomplete Garmin recovery data, follow the accepted week or reduce supporting work; report symptoms when needed.",
    );
  }
  if (
    !pain &&
    workout &&
    !ranToday &&
    !stale &&
    todayCheckIn &&
    (todayCheckIn.fatigue >= 4 || todayCheckIn.soreness >= 4)
  ) {
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
  const canSchedule =
    !!plan &&
    !!todaySchedule &&
    (todaySchedule.dayOffset !== 6 || !!workout?.race) &&
    !["paused", "return_review"].includes(todaySchedule.rule?.phase ?? "") &&
    !stale;
  const moves: Partial<Record<CoachAction, ScheduleChange[]>> = {};
  const moveWarnings: Partial<Record<CoachAction, string[]>> = {};
  if (canSchedule && !pain && !workout?.race) {
    const secondary = todaySchedule.sessions.find(
      (s) => s.session.sport !== "running" && s.status === "planned",
    );
    const fatigue = todayCheckIn
      ? Math.max(todayCheckIn.fatigue, todayCheckIn.soreness)
      : null;
    const notHigh = fatigue === null || fatigue < 4;
    if (secondary && (!workout || ranToday || notHigh))
      allowed.push("skip_secondary");
    if (
      !accepted &&
      secondary?.session.sport === "hyrox" &&
      !todaySchedule.unavailableSlots?.includes("later") &&
      recoveryAvailable &&
      notHigh &&
      todaySchedule.recorded.length < 2 &&
      !todaySchedule.recorded.some((r) => r.sport === "cycling")
    )
      allowed.push("cycle");
    if (workout && !accepted && !ranToday && recoveryAvailable && notHigh) {
      for (let to = todaySchedule.dayOffset + 1; to < 6; to++) {
        try {
          const action = `move_${to}` as CoachAction;
          const preferred =
            todayRun?.slot === "morning" || todayRun?.slot === "later"
              ? todayRun.slot
              : "lunch";
          for (const slot of [
            ...new Set([preferred, "lunch", "morning", "later"] as const),
          ]) {
            try {
              moves[action] = moveRunningDay(
                sqlite,
                plan!,
                todaySchedule.dayOffset,
                to,
                activities,
                now,
                slot,
              );
              break;
            } catch {
              /* Try another available window. */
            }
          }
          if (!moves[action]) continue;
          const movedCalendar = trainingCalendar(
            sqlite,
            plan!,
            activities,
            now,
            undefined,
            { changes: moves[action] },
          );
          moveWarnings[action] = recoveryWarnings(
            movedCalendar.days,
            moves[action]!.map((c) => c.day),
          );
          allowed.push(action);
        } catch {
          /* No legal destination. */
        }
      }
    }
  }
  const recentHard = activities.some(
    (a) =>
      [shiftDay(day, -1), day].includes(calendarDate(new Date(a.startedAt))) &&
      (efforts.find((e) => e.activityId === a.id)?.rpe ?? 0) >= 7,
  );
  const moderate =
    todayCheckIn && Math.max(todayCheckIn.fatigue, todayCheckIn.soreness) >= 3;
  if (
    canSchedule &&
    !pain &&
    (moderate || recentHard || recoveryEvidence.status === "caution")
  ) {
    const secondary = todaySchedule?.sessions.some(
      (s) => s.session.sport !== "running" && s.status === "planned",
    );
    if (
      workout &&
      !ranToday &&
      (!todayCheckIn || (todayCheckIn.fatigue < 4 && todayCheckIn.soreness < 4))
    ) {
      allowed =
        workout.type === "quality"
          ? ["easy", "rest"]
          : secondary
            ? ["skip_secondary", "rest"]
            : ["follow", "rest"];
    } else if (!workout || ranToday)
      allowed = secondary ? ["skip_secondary", "rest"] : ["follow", "rest"];
    constraints.push(
      "Recent effort or fatigue calls for protecting recovery. Remove uncompleted secondary training; convert quality to reviewed recovery HR or rest. The one-hour cycling minimum never requires a ride.",
    );
  }
  if (todaySchedule && todaySchedule.recorded.length >= 2) {
    allowed = pain ? ["rest"] : ["follow", "rest"];
    constraints.push(
      "Two workouts are already recorded today. Do not add or reschedule more training today.",
    );
  }
  if (todaySchedule?.dayOffset === 6 && !workout?.race) {
    allowed = pain ? ["rest"] : ["follow"];
    constraints.push(
      "Sunday rests unless an explicit race is scheduled. Do not add ordinary training.",
    );
  }
  const gate = calendarGate(commitments, day, monday);
  if (
    ["paused", "return_review"].includes(todaySchedule?.rule?.phase ?? "") ||
    (!plan && gate.blocked)
  ) {
    allowed = pain ? ["rest"] : ["follow", "rest"];
    constraints.push(
      gate.reason,
      "Do not resume, add, move or substitute training during a break or pending return review.",
    );
  }
  if (workout?.race) {
    allowed =
      pain ||
      stale ||
      !recoveryAvailable ||
      (todayCheckIn &&
        (todayCheckIn.fatigue >= 4 || todayCheckIn.soreness >= 4)) ||
      recoveryEvidence.status === "caution"
        ? ["rest"]
        : ranToday
          ? ["follow"]
          : ["follow", "rest"];
    constraints.push(
      "Explicit scheduled race: the course and event date are fixed. Never shorten, move, add a second run or replace it with cycling. Race registration does not prove readiness. Rest if current recovery or preparation is inadequate.",
    );
  }
  if (gate.blocked) {
    development.eligible = false;
    development.reason = gate.reason;
  }
  constraints.push(
    "Running is the priority. Cycling never replaces a run. At most two workouts daily. Weekday lunch <=120 min; later sessions and Saturday have no availability cap. Hyrox is only Monday, Wednesday, Friday. Volume increases require a separately reviewed week.",
  );
  const health = prepare(
    sqlite,
    "SELECT day,sleep_seconds AS sleepSeconds,resting_heart_rate AS restingHeartRate,body_battery AS bodyBattery FROM daily_health WHERE day BETWEEN ? AND ? ORDER BY day",
  ).all(shiftDay(day, -6), day);
  const progression = assessProgression({
    policy: planningPolicy(sqlite),
    now,
    plans,
    weeks,
    checkIns: training.checkIns(),
    activities,
    lastSync,
    load,
    recovery: recoveryEvidence,
  });
  const prior = plans
    .filter((p) => shiftDay(p.start, 7) <= day)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  if (
    gate.blocked ||
    (prior &&
      trainingCalendar(sqlite, prior, activities, now).days.some(
        (d) => !!d.rule,
      ))
  ) {
    progression.decision = "hold";
    progression.suggestedKm = null;
    progression.reasons.unshift(
      gate.reason ||
        "Complete a normal reviewed baseline after race recovery or a break before increasing.",
    );
  }
  // Explicit allowlist: never send raw activity JSON, locations, names, notes or credentials.
  const payload = {
    day,
    roadRacePacing: racePacingContext(
      racePacingData(sqlite, now, activities, commitments, athlete.targets)
        .racePaceAdvice,
    ),
    recoveryEvidence,
    subjectiveRecovery: {
      optional: true,
      lastReportedDay: todayCheckIn?.day ?? null,
    },
    workoutPreferences: {
      stepTarget: "distance",
      minimumRunKm,
      minimumCyclingMinutes: MINIMUM_CYCLING_MINUTES,
    },
    lastSync,
    schedule: calendar
      ? {
          ...calendar,
          days: calendar.days.map((d) => ({
            ...d,
            race: d.race ? raceSummary(d.race) : undefined,
            sessions: d.sessions.map((s) =>
              s.session.sport === "running" && s.session.workout.race
                ? {
                    ...s,
                    session: {
                      ...s.session,
                      workout: {
                        ...s.session.workout,
                        title: "Scheduled race",
                        race: raceSummary(s.session.workout.race),
                      },
                    },
                  }
                : s.session.sport === "running" && s.session.workout.trail
                  ? {
                      ...s,
                      session: {
                        ...s.session,
                        workout: {
                          ...s.session.workout,
                          trail: {
                            expectedMinutes:
                              s.session.workout.trail.expectedMinutes,
                            ascentM: s.session.workout.trail.ascentM ?? null,
                          },
                        },
                      },
                    }
                  : s,
            ),
          })),
        }
      : null,
    commitments: {
      races: commitments.races
        .filter((r) => r.status !== "cancelled" && r.day >= shiftDay(day, -14))
        .slice(0, 12)
        .map(raceSummary),
      pauses: commitments.pauses
        .filter((p) => !p.cancelled)
        .map(
          ({
            start,
            end,
            reason,
            resumeOn,
            returnReviewedAt,
            baselineReviewedAt,
          }) => ({
            start,
            end,
            reason,
            resumeOn,
            returnReviewedAt,
            baselineReviewedAt,
          }),
        ),
    },
    athlete: {
      goal: athlete.goal,
      targets: athlete.targets,
      calibrationSource: athlete.calibrationSource,
      reviewedAt: athlete.reviewedAt,
    },
    development,
    combinedLoad: load,
    plannedLoad:
      calendar && plan ? reviewPlannedWeek(calendar, plan, load) : null,
    preferences: scheduleRepository.preferences(),
    hyroxAttendance: scheduleRepository.week(monday).hyrox,
    unavailableTrainingWindows: scheduleRepository
      .availability()
      .filter((b) => b.day >= monday && b.day < shiftDay(monday, 14))
      .map(({ day, slots }) => ({ day, slots })),
    movableRunDays: Object.keys(moves),
    moveRecoveryWarnings: moveWarnings,
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
            sessionRpe: efforts.find((e) => e.activityId === a.id)?.rpe ?? null,
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
          cycle: trainingCycle(plan.weekNumber, plan.policy, plan.start),
        }
      : null,
    workoutReview: workoutReviewSummary(sqlite, now),
    fitnessEvidence: fitnessEvidenceSummary(sqlite),
    todayWorkout: effectiveWorkout
      ? { type: effectiveWorkout.type, steps: effectiveWorkout.steps }
      : null,
    ranToday,
    acceptedReview: accepted?.review_id ?? null,
    comparison: comparableRuns(activities, now, {
      min: athlete.targets.baseMin,
      max: athlete.targets.baseMax,
    }),
    progression,
    constraints,
    allowedActions: allowed,
  };
  // The private plan fingerprint also invalidates approvals when another day is edited.
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        payload,
        plan,
        commitments,
        scheduleRevision: scheduleRepository.revisionData(),
      }),
    )
    .digest("hex");
  return {
    payload,
    hash,
    plan,
    workout,
    day,
    allowed,
    constraints,
    todaySchedule,
    athlete,
    moves,
    canSchedule,
    preferences: scheduleRepository.preferences(),
    canAdjust:
      !!workout &&
      !!effectiveWorkout &&
      !ranToday &&
      (todaySchedule?.recorded.length ?? 0) < 2 &&
      !stale &&
      (recoveryAvailable || pain),
  };
}
export type CoachData = ReturnType<typeof coachContext>;
export function allowedActions(
  context: CoachData,
  kind: CoachKind,
): CoachAction[] {
  return kind === "weekly" ? ["follow"] : context.allowed;
}
