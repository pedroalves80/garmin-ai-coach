import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeMutation } from "@/server/security/authorize";
import { getDatabase } from "@/server/db/client";
import { saveReviewedPlan, PlanSaveError } from "@/server/training/save-plan";
import { ScheduleRuleError } from "@/shared/weekly-schedule";
export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 4096)
      return NextResponse.json(
        { error: "Plan request is too large" },
        { status: 413 },
      );
    const result = saveReviewedPlan(getDatabase(), JSON.parse(text));
    return NextResponse.json({
      saved: result.saved,
      plannedKm: result.plannedKm,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof PlanSaveError || error instanceof ScheduleRuleError
            ? error.message
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? "Choose valid week and pace settings."
              : "The selected settings cannot fit the workout steps.",
      },
      { status: error instanceof PlanSaveError ? error.status : 400 },
    );
  }
}
