import { planningPolicy } from "./planning-policy";
import { recordPrescriptionCalendar } from "./prescription-snapshots";
import { fitMileageWeek } from "../../shared/fit-mileage-week";
import { applyAvailability } from "../../shared/schedule-editing";
import { milestoneForWeek, distributeMileage } from "../../shared/milestones";
import type Database from "better-sqlite3";
import type { WeekSchedule } from "../../shared/types/schedule";
import type { TrainingPlan } from "../../shared/types/metrics";
import { CommitmentRepository } from "./commitment-repository";
import {
  calendarGate,
  applyCommitments,
} from "../../shared/commitment-calendar";
import { TrainingRepository } from "./repository";
import { planSettingsSchema } from "./validation";
import { planKm, workoutKm } from "../../shared/training-plan";
import { calendarDate, mondayOf, shiftDay } from "./dates";
import { developedPlan } from "../../shared/plan-development";
import { reviewPlannedWeek } from "../../shared/planned-load";
import { buildWeekSchedule } from "../../shared/weekly-schedule";
import { ScheduleRepository } from "./schedule-repository";
import { trainingDashboardData } from "./dashboard";
import { validateRunningSchedule } from "../../shared/weekly-schedule";

export class PlanSaveError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function saveReviewedPlan(
  db: Database.Database,
  input: unknown,
  now = new Date(),
  exactPlan?: TrainingPlan,
  exactCalendar?: WeekSchedule,
) {
  const parsed = planSettingsSchema.parse(input);
  const monday = mondayOf(calendarDate(now));
  if (parsed.start < monday || parsed.start > shiftDay(monday, 730))
    throw new PlanSaveError(
      "Choose this week or a future Monday within two years.",
    );
  const { weekNumber, start, easyPace, tempoPace, targetKm } = parsed;
  const repository = new TrainingRepository(db),
    data = trainingDashboardData(now, db);
  let plan =
    exactPlan ??
    developedPlan(
      {
        weekNumber,
        start,
        easyPace,
        tempoPace,
        targetKm,
        policy: planningPolicy(db),
      },
      data.athlete,
      repository.plans(),
      data.development,
    );
  if (
    exactPlan &&
    (plan.start !== start ||
      plan.weekNumber !== weekNumber ||
      plan.easyPace !== easyPace ||
      plan.tempoPace !== tempoPace ||
      (targetKm !== undefined && plan.targetKm !== targetKm))
  )
    throw new PlanSaveError(
      "The proposed plan does not match its reviewed settings.",
      409,
    );
  if (plan.development?.qualityForecast)
    throw new PlanSaveError(
      "Future tempo forecasts cannot be activated. Accept an evidence-reviewed weekly proposal instead.",
      409,
    );
  plan = { ...plan, planningVersion: 2 };
  validateRunningSchedule(plan);
  const previous = repository
    .plans()
    .filter((p) => p.start < start)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  const existing = repository.plans().find((p) => p.start === start);
  const expected = milestoneForWeek(
    start,
    repository.plans(),
    planningPolicy(db),
  );
  const proposal =
    start === data.weeklyRecommendation.start
      ? data.weeklyRecommendation
      : start === data.nextWeeklyRecommendation.start
        ? data.nextWeeklyRecommendation
        : null;
  if (weekNumber !== expected.stage && existing?.weekNumber !== weekNumber)
    throw new PlanSaveError(
      `This week belongs to Stage ${expected.stage}; future milestones stay forecasts.`,
      409,
    );
  if (
    existing &&
    existing.weekNumber !== weekNumber &&
    weekNumber !== expected.stage
  )
    throw new PlanSaveError("Choose the corrected calendar stage.", 409);
  if (!proposal)
    throw new PlanSaveError(
      "Only this week or next week can be activated. Later weeks remain forecasts.",
      409,
    );
  if (proposal.blockedReason)
    throw new PlanSaveError(proposal.blockedReason, 409);
  if (plan.targetKm > proposal.selected.plan.targetKm + 0.05)
    throw new PlanSaveError(
      `The reviewed proposal currently supports ${proposal.selected.plan.targetKm.toFixed(1)} km. Review its running and recovery evidence before increasing further.`,
      409,
    );
  const longestCompleted = Math.max(
    0,
    ...data.effortSessions
      .filter(
        (a) => a.sport === "running" && a.day >= shiftDay(data.today, -30),
      )
      .map((a) => a.km),
  );
  if (!exactPlan && previous && planKm(plan) > planKm(previous) + 0.05) {
    const distributed = distributeMileage(plan, longestCompleted);
    if (!distributed)
      throw new PlanSaveError(
        "The target does not fit recent single-run distances and weekday time limits. Review the mileage distribution.",
        409,
      );
    plan = distributed;
  }
  const schedule = new ScheduleRepository(db);
  const weekSettings = exactPlan
    ? (schedule.weeks()[start] ?? proposal.selected.preferences)
    : proposal.selected.preferences;
  const selectedCalendar =
    exactCalendar ??
    fitMileageWeek(
      applyAvailability(
        applyCommitments(
          buildWeekSchedule(
            plan,
            weekSettings,
            schedule.preferences(),
            [],
            data.effortSessions.map((a) => ({
              day: a.day,
              sport: a.sport,
              minutes: a.minutes,
              km: a.sport === "running" ? a.countedKm : a.km,
            })),
          ),
          plan,
          data.commitments,
          data.athlete.targets,
          data.calendarOptions,
        ),
        data.availability,
      ),
      plan,
      data.commitments,
      data.calendarOptions,
    ).calendar;
  if (
    selectedCalendar.days.some(
      (d) =>
        d.race &&
        d.rule?.phase === "race_recovery" &&
        !d.sessions.some(
          (s) => s.session.sport === "running" && s.session.workout.race,
        ),
    )
  )
    throw new PlanSaveError(
      "Resolve the overlapping race participation in Events before accepting this week.",
    );
  const proposedReview = reviewPlannedWeek(selectedCalendar, plan, data.load);
  const oldTargets = previous?.development?.targets;
  const newTargets = plan.development?.targets;
  const faster =
    previous &&
    (tempoPace < previous.tempoPace ||
      (newTargets &&
        (
          [
            "baseMin",
            "baseMax",
            "recoveryMin",
            "recoveryMax",
            "longMin",
            "longMax",
          ] as const
        ).some(
          (key) =>
            newTargets[key] >
            (oldTargets?.[key] ??
              {
                baseMin: 135,
                baseMax: 148,
                recoveryMin: 125,
                recoveryMax: 140,
                longMin: 135,
                longMax: 150,
              }[key]),
        )) ||
      (newTargets &&
        (newTargets.strideMin < (oldTargets?.strideMin ?? 240) ||
          newTargets.strideMax < (oldTargets?.strideMax ?? 270))));
  if (faster && !data.development.calibrationFresh)
    throw new PlanSaveError(
      "Review running targets with current evidence in Settings before prescribing higher intensity.",
      409,
    );
  const advancing =
    previous &&
    (planKm(plan) > planKm(previous) + 0.05 ||
      (plan.development?.qualityLevel ?? 0) >
        (previous.development?.qualityLevel ?? 0) ||
      faster);
  const gate = calendarGate(data.commitments, data.today, start);
  const volumeGate = calendarGate(
    { ...data.commitments, races: [] },
    data.today,
    start,
  );
  if (advancing && volumeGate.blocked)
    throw new PlanSaveError(volumeGate.reason, 409);
  if (
    (faster ||
      (plan.development?.qualityLevel ?? 0) >
        (previous?.development?.qualityLevel ?? 0)) &&
    gate.blocked
  )
    throw new PlanSaveError(gate.reason, 409);
  if (
    advancing &&
    (proposedReview.hardDays > 3 ||
      (proposedReview.baselineAu &&
        proposedReview.estimatedAu > proposedReview.baselineAu * 1.15))
  )
    throw new PlanSaveError(
      "Review combined effort before progressing: remove demanding secondary sessions in the attendance settings, or consolidate this running week.",
      409,
    );
  if (previous && planKm(plan) > planKm(previous) + 0.05 && faster)
    throw new PlanSaveError(
      "Develop distance or intensity in one review, not both. Consolidate volume when reviewing faster pace or higher HR targets.",
      409,
    );
  const longest = Math.max(
    0,
    ...data.effortSessions
      .filter(
        (a) => a.sport === "running" && a.day >= shiftDay(data.today, -30),
      )
      .map((a) => a.km),
  );
  const proposedLongest = Math.max(
    0,
    ...selectedCalendar.days.flatMap((d) =>
      d.sessions.flatMap((s) =>
        s.session.sport === "running" && !s.session.workout.race
          ? [workoutKm(s.session.workout, plan.easyPace)]
          : [],
      ),
    ),
  );
  if (advancing && longest > 0 && proposedLongest > longest * 1.1 + 0.01)
    throw new PlanSaveError(
      "The proposed longest run exceeds the longest completed run in 30 days by over 10%. Review its distance before progressing.",
      409,
    );
  db.transaction(() => {
    schedule.saveWeek(start, weekSettings);
    repository.savePlan(plan, now);
    if (
      selectedCalendar.days.some(
        (d) =>
          d.rule &&
          ["race", "race_week", "race_recovery", "taper"].includes(
            d.rule.phase,
          ),
      )
    )
      schedule.saveChanges(
        selectedCalendar.days.map((d) => ({
          day: d.day,
          sessions: d.sessions.flatMap((s) =>
            s.session.sport === "running" && s.session.workout.race
              ? []
              : [s.session],
          ),
        })),
        null,
      );
    recordPrescriptionCalendar(
      db,
      selectedCalendar,
      plan.easyPace,
      now,
      "approved",
      plan.start,
    );
    const commitments = new CommitmentRepository(db);
    for (const pause of commitments.all().pauses)
      if (pause.staleWeeks?.includes(start))
        commitments.savePause({
          ...pause,
          staleWeeks: pause.staleWeeks.filter((w) => w !== start),
        });
  })();
  return { saved: true, plannedKm: planKm(plan), plan };
}
