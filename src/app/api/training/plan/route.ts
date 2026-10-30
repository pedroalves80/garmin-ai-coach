import { NextResponse } from "next/server";
import { authorizeMutation } from "@/server/security/authorize";
import { getDatabase } from "@/server/db/client";
import { TrainingRepository } from "@/server/training/repository";
import { planSettingsSchema } from "@/server/training/validation";
import { createTrainingPlan, planKm } from "@/shared/training-plan";
import { calendarDate, mondayOf, shiftDay } from "@/server/training/dates";
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
    parsed.data.start > shiftDay(monday, 210)
  )
    return NextResponse.json(
      {
        error:
          "Choose valid paces and a Monday from this week through the next 30 weeks.",
      },
      { status: 400 },
    );
  try {
    const { weekNumber, start, easyPace, tempoPace, targetKm } = parsed.data;
    const plan = createTrainingPlan(
      weekNumber,
      start,
      easyPace,
      tempoPace,
      targetKm,
    );
    const repository = new TrainingRepository(getDatabase());
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
      const readiness = trainingDashboardData().progression;
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
    repository.savePlan(plan);
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
