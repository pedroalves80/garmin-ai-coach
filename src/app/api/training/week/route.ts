import { NextResponse, connection } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { authorizeMutation } from "@/server/security/authorize";
import { weeklyPlanning } from "@/server/training/weekly-planning";
import { acceptPreparedWeek } from "@/server/coach/weekly";
import { CoachError } from "@/server/coach/service";
import { PlanSaveError } from "@/server/training/save-plan";
import { ScheduleRuleError } from "@/shared/weekly-schedule";
export async function GET() {
  await connection();
  return NextResponse.json(weeklyPlanning(getDatabase()), {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 512)
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    const input = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(JSON.parse(text));
    return NextResponse.json(acceptPreparedWeek(getDatabase(), input.token), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof CoachError ||
          error instanceof PlanSaveError ||
          error instanceof ScheduleRuleError
            ? error.message
            : "Could not accept this week. Refresh the proposal and try again.",
      },
      {
        status:
          error instanceof CoachError || error instanceof PlanSaveError
            ? error.status
            : 400,
      },
    );
  }
}
