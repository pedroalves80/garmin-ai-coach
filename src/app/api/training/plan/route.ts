import { CommitmentRepository } from "@/server/training/commitment-repository";
import { calendarGate, applyCommitments } from "@/shared/commitment-calendar";
import { NextResponse } from "next/server";
import { authorizeMutation } from "@/server/security/authorize";
import { getDatabase } from "@/server/db/client";
import { TrainingRepository } from "@/server/training/repository";
import { planSettingsSchema } from "@/server/training/validation";
import { planKm, workoutKm } from "@/shared/training-plan";
import { calendarDate, mondayOf, shiftDay } from "@/server/training/dates";
import { developedPlan } from "@/shared/plan-development";
import { reviewPlannedWeek } from "@/shared/planned-load";
import { buildWeekSchedule } from "@/shared/weekly-schedule";
import { ScheduleRepository } from "@/server/training/schedule-repository";
import { trainingDashboardData } from "@/server/training/dashboard";
import {
  validateRunningSchedule,
  ScheduleRuleError,
} from "@/shared/weekly-schedule";

export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  let input: unknown;
  try {
    const text = await request.text();
    if (text.length > 4096)
      return NextResponse.json(
        { error: "Plan request is too large" },
        { status: 413 },
      );
    input = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = planSettingsSchema.safeParse(input);
  const monday = mondayOf(calendarDate(new Date()));
  if (
    !parsed.success ||
    parsed.data.start < monday ||
    parsed.data.start > shiftDay(monday, 730)
  )
    return NextResponse.json(
      {
        error:
          "Choose valid paces and a Monday from this week through the next two years.",
      },
      { status: 400 },
    );
  try {
    const { weekNumber, start, easyPace, tempoPace, targetKm } = parsed.data;
    const db = getDatabase(),
      repository = new TrainingRepository(db),
      data = trainingDashboardData();
    const plan = developedPlan(
      { weekNumber, start, easyPace, tempoPace, targetKm },
      data.athlete,
      repository.plans(),
      data.development,
    );
    validateRunningSchedule(plan);
    // Higher milestones are previews. Approval advances only one stage at a time.
    const previous = repository
      .plans()
      .filter((p) => p.start < start)
      .sort((a, b) => b.start.localeCompare(a.start))[0];
    const existing = repository.plans().find((p) => p.start === start);
    if (existing && existing.weekNumber !== weekNumber)
      return NextResponse.json(
        {
          error:
            "A saved week keeps its stage. Choose a later Monday to advance.",
        },
        { status: 409 },
      );
    if (weekNumber > (previous?.weekNumber ?? existing?.weekNumber ?? 0) + 1)
      return NextResponse.json(
        {
          error:
            "Save the starting week first, then review milestones one at a time.",
        },
        { status: 409 },
      );
    if (previous && planKm(plan) > planKm(previous) + 0.05) {
      const readiness = data.progression;
      if (
        readiness.decision !== "increase" ||
        readiness.suggestedKm === null ||
        planKm(plan) > readiness.suggestedKm + 0.05
      )
        return NextResponse.json(
          {
            error: `Volume is not cleared for this increase. ${readiness.reasons[0]}${readiness.suggestedKm === null ? "" : ` Review about ${readiness.suggestedKm.toFixed(1)} km.`}`,
          },
          { status: 409 },
        );
    }
    const schedule = new ScheduleRepository(db);
    const proposedReview = reviewPlannedWeek(
      applyCommitments(
        buildWeekSchedule(plan, schedule.week(start), schedule.preferences()),
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
      return NextResponse.json(
        {
          error:
            "Review running targets with current evidence in Settings before prescribing higher intensity.",
        },
        { status: 409 },
      );
    const advancing =
      previous &&
      (planKm(plan) > planKm(previous) + 0.05 ||
        (plan.development?.qualityLevel ?? 0) >
          (previous.development?.qualityLevel ?? 0) ||
        faster);
    const gate = calendarGate(data.commitments, data.today, start);
    if (advancing && gate.blocked)
      return NextResponse.json({ error: gate.reason }, { status: 409 });
    if (
      advancing &&
      (proposedReview.hardDays > 3 ||
        (proposedReview.baselineAu &&
          proposedReview.estimatedAu > proposedReview.baselineAu * 1.15))
    )
      return NextResponse.json(
        {
          error:
            "Review combined effort before progressing: remove demanding secondary sessions in the attendance settings, or consolidate this running week.",
        },
        { status: 409 },
      );
    if (previous && planKm(plan) > planKm(previous) + 0.05 && faster)
      return NextResponse.json(
        {
          error:
            "Develop distance or intensity in one review, not both. Consolidate volume when reviewing faster pace or higher HR targets.",
        },
        { status: 409 },
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
      return NextResponse.json(
        {
          error:
            "The proposed longest run exceeds the longest completed run in 30 days by over 10%. Review its distance before progressing.",
        },
        { status: 409 },
      );
    db.transaction(() => {
      repository.savePlan(plan);
      const commitments = new CommitmentRepository(db);
      for (const pause of commitments.all().pauses)
        if (pause.staleWeeks?.includes(start))
          commitments.savePause({
            ...pause,
            staleWeeks: pause.staleWeeks.filter((w) => w !== start),
          });
    })();
    return NextResponse.json({ saved: true, plannedKm: planKm(plan) });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ScheduleRuleError
            ? error.message
            : "The selected settings cannot fit the workout steps.",
      },
      { status: 400 },
    );
  }
}
