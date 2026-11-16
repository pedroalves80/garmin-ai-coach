import { captureUpcomingWorkouts } from "@/server/training/review-capture";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeMutation } from "@/server/security/authorize";
import { getDatabase } from "@/server/db/client";
import {
  AthleteRepository,
  athleteSchema,
  effortSchema,
} from "@/server/training/athlete-repository";
import { calendarDate, shiftDay } from "@/server/training/dates";
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("profile"), profile: athleteSchema }).strict(),
  z.object({ action: z.literal("effort"), effort: effortSchema }).strict(),
]);
export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 4096)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success)
      return NextResponse.json(
        {
          error:
            "Use valid effort scores or ordered pace/HR targets with review evidence.",
        },
        { status: 400 },
      );
    const db = getDatabase(),
      repository = new AthleteRepository(db),
      now = new Date(),
      today = calendarDate(now),
      input = parsed.data;
    if (input.action === "profile") {
      if (input.profile.reviewedAt && input.profile.reviewedAt > today)
        return NextResponse.json(
          { error: "Target reviews cannot be future dated." },
          { status: 400 },
        );
      db.transaction(() => {
        repository.saveProfile(input.profile);
        captureUpcomingWorkouts(db, now, "change");
      }).immediate();
    } else {
      const row = db
        .prepare("SELECT started_at FROM activities WHERE id=?")
        .get(input.effort.activityId) as { started_at: string } | undefined;
      if (
        !row ||
        Date.parse(row.started_at) > now.getTime() ||
        calendarDate(new Date(row.started_at)) < shiftDay(today, -90)
      )
        return NextResponse.json(
          { error: "Choose a recorded session within the last 90 days." },
          { status: 400 },
        );
      db.transaction(() => {
        repository.saveEffort(input.effort);
        captureUpcomingWorkouts(db, now, "change");
      }).immediate();
    }
    return NextResponse.json({ saved: true });
  } catch {
    return NextResponse.json(
      { error: "Could not save athlete settings. Check the inputs and retry." },
      { status: 400 },
    );
  }
}
