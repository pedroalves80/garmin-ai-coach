import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizeMutation } from "@/server/security/authorize";
import { getDatabase } from "@/server/db/client";
import {
  saveFitnessEvidence,
  FitnessEvidenceError,
} from "@/server/training/fitness-evidence";
export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body) > 4096)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    saveFitnessEvidence(getDatabase(), JSON.parse(body));
    return NextResponse.json(
      { saved: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof FitnessEvidenceError
            ? e.message
            : e instanceof ZodError || e instanceof SyntaxError
              ? "Check the fields and try again."
              : "Could not save. Refresh and try again.",
      },
      {
        status:
          e instanceof FitnessEvidenceError && "status" in e
            ? Number(e.status)
            : 400,
      },
    );
  }
}
