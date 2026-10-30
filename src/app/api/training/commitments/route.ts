import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizeMutation } from "@/server/security/authorize";
import { getDatabase } from "@/server/db/client";
import {
  updateCommitment,
  CommitmentError,
} from "@/server/training/commitments";
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
    updateCommitment(getDatabase(), JSON.parse(text));
    return NextResponse.json(
      { saved: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ZodError
            ? "Check the event or break fields."
            : error instanceof CommitmentError
              ? error.message
              : "Could not save the calendar.",
      },
      { status: 400 },
    );
  }
}
