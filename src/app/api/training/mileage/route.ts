import { captureUpcomingWorkouts } from "@/server/training/review-capture";
import { NextResponse } from "next/server";
import { authorizeMutation } from "@/server/security/authorize";
import { getDatabase } from "@/server/db/client";
import {
  mileageInput,
  saveRaceExtras,
  MileageError,
} from "@/server/training/mileage";
export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 2048)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const input = mileageInput.safeParse(JSON.parse(text));
    if (!input.success)
      return NextResponse.json(
        {
          error:
            "Choose a recorded run, its race and confirmed race-extra kilometres.",
        },
        { status: 400 },
      );
    const db = getDatabase();
    const result = db
      .transaction(() => {
        const saved = saveRaceExtras(db, input.data);
        captureUpcomingWorkouts(db, new Date(), "change");
        return saved;
      })
      .immediate();
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof MileageError
            ? error.message
            : "Could not save race mileage.",
      },
      { status: 400 },
    );
  }
}
