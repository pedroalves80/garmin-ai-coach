import type Database from "better-sqlite3";
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
  const plan =
    exactPlan ??
    developedPlan(
      { weekNumber, start, easyPace, tempoPace, targetKm },
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
  validateRunningSchedule(plan);
  // Higher milestones are previews. Approval advances only one stage at a time.
  const previous = repository
    .plans()
    .filter((p) => p.start < start)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  const existing = repository.plans().find((p) => p.start === start);
  if (existing && existing.weekNumber !== weekNumber)
    throw new PlanSaveError(
      "A saved week keeps its stage. Choose a later Monday to advance.",
      409,
    );
  if (weekNumber > (previous?.weekNumber ?? existing?.weekNumber ?? 0) + 1)
    throw new PlanSaveError(
      "Save the starting week first, then review milestones one at a time.",
      409,
    );
  if (previous && planKm(plan) > planKm(previous) + 0.05) {
    const readiness = data.progression;
    if (
      readiness.decision !== "increase" ||
      readiness.suggestedKm === null ||
      planKm(plan) > readiness.suggestedKm + 0.05
    )
      throw new PlanSaveError(
        `Volume is not cleared for this increase. ${readiness.reasons[0]}${readiness.suggestedKm === null ? "" : ` Review about ${readiness.suggestedKm.toFixed(1)} km.`}`,
        409,
      );
  }
  if (
    !existing &&
    start === data.monday &&
    data.weeklyRecommendation.blockedReason
  )
    throw new PlanSaveError(data.weeklyRecommendation.blockedReason, 409);
  const schedule = new ScheduleRepository(db);
  const weekSettings =
    schedule.weeks()[start] ??
    (start === data.monday
      ? data.weeklyRecommendation.selected.preferences
      : schedule.week(start));
  const proposedReview = reviewPlannedWeek(
    applyCommitments(
      buildWeekSchedule(plan, weekSettings, schedule.preferences()),
      plan,
      data.commitments,
      data.athlete.targets,
      data.calendarOptions,
    ),
    plan,
    data.load,
  );
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
  if (advancing && gate.blocked) throw new PlanSaveError(gate.reason, 409);
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
    ...plan.workouts.map((w) => workoutKm(w, plan.easyPace)),
  );
  if (advancing && longest > 0 && proposedLongest > longest * 1.1 + 0.01)
    throw new PlanSaveError(
      "The proposed longest run exceeds the longest completed run in 30 days by over 10%. Review its distance before progressing.",
      409,
    );
  db.transaction(() => {
    if (!schedule.weeks()[start]) schedule.saveWeek(start, weekSettings);
    repository.savePlan(plan, now);
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
