import { NextResponse } from "next/server";
import { authorizeMutation } from "@/server/security/authorize";
import { getDatabase } from "@/server/db/client";
import {
  RacePacingRepository,
  paceEvidenceSchema,
} from "@/server/training/race-pacing-repository";
export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 1024)
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    const v = paceEvidenceSchema.parse(JSON.parse(text));
    new RacePacingRepository(getDatabase()).save(v);
    return NextResponse.json({ saved: true });
  } catch {
    return NextResponse.json(
      {
        error:
          "Use confirmed road evidence dated within the last 90 days and a valid whole-course time. Future goals are not performance evidence.",
      },
      { status: 400 },
    );
  }
}
