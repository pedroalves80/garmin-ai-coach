import { raceRecoveryEvidence } from "./race-recovery";
import { racePacingData } from "./race-pacing";
import {
  weeklyOutput,
  permittedWeeklyChoice,
  supportingWorkload,
} from "./weekly-policy";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  WeeklyPlanning,
  WeeklyPlanOption,
  WeeklyOptionId,
} from "../../shared/types/weekly-planning";
import { DEFAULT_WEEK_PREFERENCES } from "../../shared/types/schedule";
import {
  planKm,
  volumeMilestones,
  workoutKm,
} from "../../shared/training-plan";
import { developedPlan } from "../../shared/plan-development";
import {
  applyCommitments,
  calendarGate,
  pauseActive,
  pendingReturn,
} from "../../shared/commitment-calendar";
import { applyAvailability } from "../../shared/schedule-editing";
import {
  buildWeekSchedule,
  validateRunningSchedule,
} from "../../shared/weekly-schedule";
import { reviewPlannedWeek } from "../../shared/planned-load";
import { prepare } from "../db/statements";
import { GarminRepository } from "../db/garmin-repository";
import { TrainingRepository } from "./repository";
import { AthleteRepository } from "./athlete-repository";
import { ScheduleRepository } from "./schedule-repository";
import { CommitmentRepository } from "./commitment-repository";
import { trainingCalendar, trainingEvidencePlans } from "./calendar";
import { developmentReadiness } from "./development";
import { calendarDate, mondayOf, shiftDay } from "./dates";
import { weeklyMetrics, comparableRuns, sportGroup } from "./metrics";
import { combinedLoadReview, measuredLoad } from "./load";
import { assessProgression } from "./progression";
import { garminRecovery, type HealthEvidenceRow } from "./recovery";
import { returnReady } from "./commitments";

export type WeeklyReviewRow = {
  week_start: string;
  evidence_hash: string;
  review_json: string | null;
  attempted_at: string;
  error: string | null;
  accepted_token: string | null;
  accepted_plan_hash: string | null;
};
export function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(
              Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
            )
          : item,
      ),
    )
    .digest("hex");
}
export function healthEvidence(db: Database.Database, today: string) {
  return prepare(
    db,
    "SELECT day,resting_heart_rate AS restingHeartRate,sleep_seconds AS sleepSeconds FROM daily_health WHERE day>=? AND day<=? ORDER BY day",
  ).all(shiftDay(today, -28), today) as HealthEvidenceRow[];
}
export function weeklyReviewRow(db: Database.Database, start: string) {
  return prepare(db, "SELECT * FROM weekly_planning WHERE week_start=?").get(
    start,
  ) as WeeklyReviewRow | undefined;
}

// Always available, including without a model/key/check-in. No provider calls or writes.
export function weeklyPlanning(
  db: Database.Database,
  now = new Date(),
): WeeklyPlanning {
  const today = calendarDate(now),
    start = mondayOf(today),
    repo = new TrainingRepository(db),
    garmin = new GarminRepository(db),
    schedule = new ScheduleRepository(db);
  const plans = repo.plans(),
    current = plans.find((p) => p.start === start),
    reference = plans
      .filter((p) => shiftDay(p.start, 7) <= start)
      .sort((a, b) => b.start.localeCompare(a.start))[0];
  const activities = garmin
      .allActivities()
      .filter((a) => Date.parse(a.startedAt) <= now.getTime()),
    weeks = weeklyMetrics(activities, now),
    lastSync = garmin.status()?.lastCompletedAt ?? null;
  const checks = repo.checkIns(),
    athleteRepo = new AthleteRepository(db),
    athlete = athleteRepo.profile(),
    efforts = athleteRepo.efforts();
  const health = healthEvidence(db, today),
    recovery = garminRecovery(health, today),
    commitmentsRepo = new CommitmentRepository(db),
    commitments = commitmentsRepo.all(),
    preferences = schedule.preferences();
  const allSettings = schedule.weeks(),
    inheritedStart = Object.keys(allSettings)
      .filter(
        (d) =>
          d < start &&
          plans.find((p) => p.start === d)?.development?.phase !== "recovery",
      )
      .sort()
      .at(-1);
  const week = structuredClone(
    allSettings[start] ??
      (inheritedStart ? allSettings[inheritedStart] : DEFAULT_WEEK_PREFERENCES),
  );
  // An undecided third class is optional supporting work, not a fourth demanding day.
  const adjustedFriday =
    !allSettings[start] && week.hyrox.friday === "undecided";
  if (adjustedFriday) week.hyrox.friday = "skipping";
  const load = combinedLoadReview(measuredLoad(activities, efforts, now));
  const progression = assessProgression({
    now,
    plans: plans.filter((p) => p.start < start),
    weeks,
    activities,
    checkIns: checks,
    lastSync,
    load,
    recovery,
  });
  const development = developmentReadiness(
    athlete,
    trainingEvidencePlans(db, plans, activities, now),
    activities,
    efforts,
    checks,
    load,
    now,
    lastSync,
    recovery,
  );
  const referenceWeek = reference
    ? (weeks.find((w) => w.start === reference.start) ??
      weeklyMetrics(
        activities,
        new Date(shiftDay(reference.start, 7) + "T12:00:00Z"),
      ).find((w) => w.start === reference.start))
    : undefined;
  const referenceAffected =
    !!reference &&
    trainingCalendar(db, reference, activities, now).days.some((d) => !!d.rule);
  const gate = calendarGate(commitments, today, start);
  const recentReference =
    !!reference && reference.start === shiftDay(start, -7);
  const completed =
    !!reference &&
    recentReference &&
    !!referenceWeek &&
    referenceWeek.runningKm >= planKm(reference) * 0.9;
  const stage =
    current?.weekNumber ??
    (reference
      ? Math.min(
          30,
          reference.weekNumber +
            (completed && !referenceAffected && !gate.blocked ? 1 : 0),
        )
      : 1);
  const ceiling = volumeMilestones[stage - 1];
  const priorKm = reference ? planKm(reference) : 25;
  let distance = current?.targetKm ?? Math.min(ceiling, priorKm);
  if (!current && reference && !recentReference) {
    const completedRecent = weeks.filter((w) => !w.partial).slice(-2);
    const observed =
      completedRecent.reduce((sum, w) => sum + w.runningKm, 0) / 2;
    distance = Math.max(20, Math.min(distance, observed));
  }
  const reasons: string[] = [];
  if (reference)
    reasons.push(
      `Stage ${reference.weekNumber}: ${referenceWeek?.runningKm.toFixed(2) ?? "0.00"} km recorded against ${priorKm.toFixed(1)} km planned.`,
    );
  else
    reasons.push(
      "Start from a 25 km baseline; Garmin history is retained and reviewed before increasing.",
    );
  if (
    !current &&
    progression.decision === "increase" &&
    progression.suggestedKm !== null &&
    completed &&
    !gate.blocked &&
    !referenceAffected
  )
    distance = Math.min(ceiling, progression.suggestedKm);
  if (!current && progression.decision === "reduce")
    distance = Math.min(
      distance,
      Math.max(20, progression.suggestedKm ?? priorKm * 0.85),
    );
  if (!current && recovery.status === "caution")
    distance = Math.min(distance, Math.max(20, priorKm * 0.85));
  if (!completed && reference)
    reasons.push(
      recentReference
        ? "Repeat the established stage while completing its running volume; missed distance is not made up."
        : "The saved stage is remembered. Re-establish a current baseline after the gap.",
    );
  if (referenceAffected || gate.blocked)
    reasons.push(
      gate.reason ||
        "A race or break affected the baseline. Hold ordinary progression.",
    );
  reasons.push(progression.reasons[0]);
  reasons.push(
    "Daily check-ins and session-effort ratings are optional. Report pain or unusual fatigue when it occurs.",
  );
  if (inheritedStart && !allSettings[start])
    reasons.push(
      `Class and cycling preferences carried forward from ${inheritedStart}; change attendance if this week differs.`,
    );
  if (adjustedFriday)
    reasons.push(
      "The undecided Friday class is left off this draft to protect the key running sessions.",
    );
  const longest = Math.max(
    0,
    ...activities
      .filter(
        (a) =>
          sportGroup(a) === "running" &&
          calendarDate(new Date(a.startedAt)) >= shiftDay(today, -30),
      )
      .map((a) => (a.distanceMeters ?? 0) / 1000),
  );
  const records = activities
    .filter((a) => sportGroup(a) !== "wellness")
    .map((a) => ({
      day: calendarDate(new Date(a.startedAt)),
      sport: sportGroup(a),
      minutes: Math.round((a.durationSeconds ?? 0) / 60),
      km: (a.distanceMeters ?? 0) / 1000,
    }));
  const options: WeeklyPlanOption[] = [];
  const make = (
    id: WeeklyOptionId,
    km: number,
    reduced = false,
  ): WeeklyPlanOption => {
    const plan = structuredClone(
      developedPlan(
        {
          weekNumber: stage,
          start,
          easyPace:
            current?.easyPace ?? reference?.easyPace ?? athlete.easyPace,
          tempoPace:
            current?.tempoPace ?? reference?.tempoPace ?? athlete.tempoPace,
          targetKm: Math.round(Math.max(20, Math.min(ceiling, km)) * 100) / 100,
        },
        athlete,
        plans,
        {
          eligible:
            id === "recommended" &&
            !reduced &&
            !gate.blocked &&
            !referenceAffected &&
            km <= priorKm + 0.05 &&
            development.eligible,
          level: development.level,
          referenceStart: development.referenceStart,
        },
      ),
    );
    const lighter =
      reduced ||
      (!plan.cutback && progression.decision === "reduce") ||
      recovery.status === "caution";
    const optionWeek = lighter
      ? {
          ...structuredClone(week),
          hyrox: {
            monday: "skipping" as const,
            wednesday: "skipping" as const,
            friday: "skipping" as const,
          },
          cyclingDays: [],
          cycleWhenSkippingHyrox: false,
        }
      : structuredClone(week);
    if (lighter) {
      plan.development = {
        ...plan.development!,
        phase: "recovery",
        reason:
          "A lighter proposed week from recorded recovery/workload evidence; no catch-up distance or automatic restoration of an old peak.",
      };
      plan.workouts = plan.workouts.map((w) => ({
        dayOffset: w.dayOffset,
        type: "recovery",
        title: "Recovery run",
        steps: [
          {
            kind: "step",
            name: "Run",
            amount: {
              kind: "distance",
              meters: Math.round(workoutKm(w, plan.easyPace) * 1000),
            },
            target: {
              kind: "hr",
              min: athlete.targets.recoveryMin,
              max: athlete.targets.recoveryMax,
            },
          },
        ],
      }));
    }
    validateRunningSchedule(plan);
    const calendar = applyAvailability(
      applyCommitments(
        buildWeekSchedule(plan, optionWeek, preferences, [], records),
        plan,
        commitments,
        athlete.targets,
        {
          today,
          returnReady: returnReady(db, now),
          raceRecovery: raceRecoveryEvidence(db, now),
          approvedRestDays: commitmentsRepo.restDays(),
          longestRecentKm: longest,
        },
      ),
      schedule.availability(),
    );
    return { id, plan, preferences: optionWeek, calendar };
  };
  let recommendation = make("recommended", distance);
  if (!current && reference && distance > priorKm + 0.05) {
    // Generated weekly totals must also respect the actual longest completed run.
    while (
      distance > priorKm + 0.05 &&
      longest > 0 &&
      Math.max(
        ...recommendation.plan.workouts.map((w) =>
          workoutKm(w, recommendation.plan.easyPace),
        ),
      ) >
        longest * 1.1 + 0.01
    ) {
      distance = Math.max(priorKm, Math.round((distance - 0.1) * 100) / 100);
      recommendation = make("recommended", distance);
    }
    const review = reviewPlannedWeek(
      recommendation.calendar,
      recommendation.plan,
      load,
    );
    if (
      review.hardDays > 3 ||
      (review.baselineAu && review.estimatedAu > review.baselineAu * 1.15)
    ) {
      recommendation = make("recommended", Math.min(ceiling, priorKm));
      reasons.push(
        "Keep running volume steady while supporting-workload concerns are reviewed.",
      );
    }
  }
  options.push(recommendation);
  const steady = make(
    "consolidate",
    Math.min(ceiling, priorKm, recommendation.plan.targetKm),
  );
  options.push(
    steady,
    make(
      "recovery",
      Math.min(steady.plan.targetKm, Math.max(20, priorKm * 0.85)),
      true,
    ),
  );
  const painReported = checks.some(
    (c) => c.day <= today && c.day >= shiftDay(today, -2) && c.pain > 0,
  );
  const blockedReason = painReported
    ? "Recent pain is reported. Review recovery or use a training break before activating another week."
    : commitments.pauses.some(
          (p) => pauseActive(p, today) || pendingReturn(p, today),
        )
      ? gate.reason
      : null;
  const comparison = comparableRuns(
    activities.filter((a) => calendarDate(new Date(a.startedAt)) < start),
    now,
    { min: athlete.targets.baseMin, max: athlete.targets.baseMax },
  );
  const performance = {
    pairs: comparison.pairs,
    secondsPerKmChange: comparison.secondsPerKmChange,
    weatherMissing: comparison.weatherMissing,
  };
  const fresh =
    !!lastSync &&
    Date.parse(lastSync) <= now.getTime() &&
    now.getTime() - Date.parse(lastSync) <= 2 * 86400000;
  const support = supportingWorkload(weeks, shiftDay(start, -7));
  const reductionEvidence: WeeklyPlanning["selectionPolicy"]["reductionEvidence"] =
    [];
  if (recovery.status === "caution")
    reductionEvidence.push({
      code: "recovery_caution",
      detail: recovery.notes[0],
    });
  if (
    checks.some(
      (c) =>
        c.day <= today &&
        c.day >= shiftDay(today, -6) &&
        (c.pain > 0 || c.fatigue > 2 || c.soreness > 2),
    )
  )
    reductionEvidence.push({
      code: "reported_recovery",
      detail: "Recent reported pain, fatigue or soreness calls for review.",
    });
  if (support.increased)
    reductionEvidence.push({
      code: "supporting_increase",
      detail: `Supporting training rose from a recent ${support.baselineMinutes!.toFixed(1)} min/week average to ${support.recentMinutes.toFixed(1)} min (${Math.round(support.change! * 100)}% increase).`,
    });
  if (load.latest.hardDays > 3 || (load.change !== null && load.change > 0.15))
    reductionEvidence.push({
      code: "combined_load",
      detail:
        "Observed rated effort growth or more than three rated hard days requires review.",
    });
  const plannedReview = reviewPlannedWeek(
    recommendation.calendar,
    recommendation.plan,
    load,
  );
  if (
    plannedReview.hardDays > 3 ||
    (plannedReview.baselineAu &&
      plannedReview.estimatedAu > plannedReview.baselineAu * 1.15)
  )
    reductionEvidence.push({
      code: "planned_load",
      detail:
        "The proposed week exceeds the configured hard-day or combined effort threshold.",
    });
  if (reference && !completed)
    reductionEvidence.push({
      code: "incomplete_running",
      detail: recentReference
        ? "The completed week has less than 90% of its planned running distance."
        : "Re-establish a current running baseline after the gap.",
    });
  if (!fresh)
    reductionEvidence.push({
      code: "stale_data",
      detail: "Garmin data is missing or over two days old.",
    });
  if (gate.blocked || referenceAffected)
    reductionEvidence.push({
      code: "calendar_restriction",
      detail: gate.reason || "A race or break affects the baseline.",
    });
  const selectionPolicy = { supportingWorkload: support, reductionEvidence };
  reasons.push(
    support.increased
      ? reductionEvidence.find((e) => e.code === "supporting_increase")!.detail
      : "Routine Hyrox and cycling are supporting-workload context, not an independent reason to hold a supported running increase.",
  );
  const history = {
    weeks: weeks.filter((w) => !w.partial),
    sessions: activities
      .filter(
        (a) =>
          calendarDate(new Date(a.startedAt)) >= shiftDay(start, -7) &&
          calendarDate(new Date(a.startedAt)) < start &&
          sportGroup(a) !== "wellness",
      )
      .slice(0, 32)
      .map((a) => {
        let raw: Record<string, unknown> = {};
        try {
          raw = JSON.parse(a.rawJson);
        } catch {
          /* Optional Garmin fields remain unknown. */
        }
        const numeric = (key: string, max: number) =>
          typeof raw[key] === "number" &&
          Number.isFinite(raw[key]) &&
          (raw[key] as number) >= 0 &&
          (raw[key] as number) <= max
            ? Math.round((raw[key] as number) * 10) / 10
            : null;
        return {
          day: calendarDate(new Date(a.startedAt)),
          sport: sportGroup(a),
          km: Math.round((a.distanceMeters ?? 0) / 10) / 100,
          minutes: Math.round((a.durationSeconds ?? 0) / 6) / 10,
          averageHeartRate: a.averageHeartRate,
          paceSecondsPerKm:
            sportGroup(a) === "running" && a.distanceMeters && a.durationSeconds
              ? Math.round(a.durationSeconds / (a.distanceMeters / 1000))
              : null,
          aerobicTrainingEffect: numeric("aerobicTrainingEffect", 5),
          trainingLoad: numeric("activityTrainingLoad", 1000),
        };
      }),
    ratedCoverage: load.latest.coverage,
  };
  const { paceEvidence, racePaceAdvice } = racePacingData(
    db,
    now,
    activities,
    commitments,
    athlete.targets,
  );
  const evidenceHash = fingerprint({
    paceEvidence,
    today,
    plans,
    activities,
    health,
    checks,
    efforts,
    athlete,
    preferences,
    week,
    commitments,
    revision: schedule.revisionData(),
    fresh,
    options,
  });
  const row = weeklyReviewRow(db, start);
  let source: WeeklyPlanning["source"] = "local",
    aiStatus: WeeklyPlanning["aiStatus"] = !preferences.automaticCoach
      ? "disabled"
      : row?.error
        ? "unavailable"
        : row?.review_json
          ? "refreshed"
          : row && now.getTime() - Date.parse(row.attempted_at) > 60000
            ? "unavailable"
            : "pending";
  let selected = recommendation,
    summary = reference
      ? `Stage ${stage} is prepared from your completed training. ${recommendation.plan.targetKm.toFixed(1)} km proposed; accept once to activate this week.`
      : "Your starting week is ready to review and accept.";
  let observations = [
    ...recovery.notes,
    performance.pairs >= 3
      ? `Matched running comparisons are available (${performance.pairs} pairs). Targets remain at their reviewed settings.`
      : "Too few comparable pace/HR pairs to claim improvement or rewrite intensity targets.",
  ];
  if (row?.review_json && row.evidence_hash === evidenceHash) {
    let cached: Record<string, unknown> = {};
    try {
      const raw = JSON.parse(row.review_json);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) cached = raw;
    } catch {
      /* Invalid cached analysis falls back locally. */
    }
    const parsed = weeklyOutput.safeParse({
      choice: cached.choice,
      reason: cached.reason,
      summary: cached.summary,
      observations: cached.observations,
    });
    const review = parsed.success ? parsed.data : null;
    const option =
      review && permittedWeeklyChoice(review, selectionPolicy)
        ? options.find((o) => o.id === review.choice)
        : undefined;
    if (option && review) {
      selected = option;
      source = "ai";
      aiStatus = "ready";
      summary = review.summary;
      observations = review.observations;
    } else {
      aiStatus = "corrected";
      observations.unshift(
        "The earlier AI selection lacked a verified reason under the current planning rules. This proposal uses the data-based recommendation without another paid request.",
      );
    }
  }
  if (current) {
    selected = {
      id: "recommended",
      plan: current,
      preferences: schedule.week(start),
      calendar: trainingCalendar(db, current, activities, now),
    };
    summary = `Stage ${current.weekNumber} is active. Your saved week and daily changes remain in place.`;
  }
  return {
    start,
    token: fingerprint({ evidenceHash, selected, source }),
    evidenceHash,
    needsApproval: !current,
    blockedReason,
    reference: reference
      ? {
          start: reference.start,
          stage: reference.weekNumber,
          plannedKm: priorKm,
          recordedKm: referenceWeek?.runningKm ?? 0,
          runs: referenceWeek?.runs ?? 0,
        }
      : null,
    recovery,
    history,
    source,
    aiStatus,
    summary,
    observations,
    reasons,
    selected,
    options,
    performance,
    selectionPolicy,
    racePaceAdvice,
  };
}
