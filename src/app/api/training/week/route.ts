import { NextResponse, connection } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { authorizeMutation } from "@/server/security/authorize";
import { weeklyPlanning } from "@/server/training/weekly-planning";
import { acceptPreparedWeek } from "@/server/coach/weekly";
import { CoachError } from "@/server/coach/service";
import { PlanSaveError } from "@/server/training/save-plan";
import { ScheduleRuleError } from "@/shared/weekly-schedule";
export async function GET(request: Request) {
  await connection();
  const value = new URL(request.url).searchParams.get("start");
  if (value && !z.iso.date().safeParse(value).success)
    return NextResponse.json(
      { error: "Choose a valid Monday." },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      weeklyPlanning(getDatabase(), new Date(), value ?? undefined),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Review this week or the immediately following week." },
      { status: 400 },
    );
  }
}
export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 512)
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    const input = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        start: z.iso.date().optional(),
      })
      .strict()
      .parse(JSON.parse(text));
    return NextResponse.json(
      acceptPreparedWeek(getDatabase(), input.token, new Date(), input.start),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
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
