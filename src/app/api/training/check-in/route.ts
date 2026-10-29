import { NextResponse } from "next/server";
import { authorizeMutation } from "@/server/security/authorize";
import { getDatabase } from "@/server/db/client";
import { TrainingRepository } from "@/server/training/repository";
import { checkInSchema } from "@/server/training/validation";
import { calendarDate, shiftDay } from "@/server/training/dates";

export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  let input: unknown;
  try {
    const text = await request.text();
    if (text.length > 4096)
      return NextResponse.json(
        { error: "Check-in is too large" },
        { status: 413 },
      );
    input = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = checkInSchema.safeParse(input);
  const today = calendarDate(new Date());
  if (
    !parsed.success ||
    parsed.data.day > today ||
    parsed.data.day < shiftDay(today, -14)
  )
    return NextResponse.json(
      { error: "Use valid scores and a date within the last 14 days." },
      { status: 400 },
    );
  new TrainingRepository(getDatabase()).saveCheckIn(parsed.data);
  return NextResponse.json({ saved: true });
}
