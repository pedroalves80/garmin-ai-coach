import { NextResponse, connection } from "next/server";
import { getDatabase } from "@/server/db/client";
import { authorizeMutation } from "@/server/security/authorize";
import {
  planningPolicyReview,
  savePlanningPolicy,
  PlanningPolicyError,
} from "@/server/training/planning-policy";
export async function GET(request: Request) {
  await connection();
  const raw = new URL(request.url).searchParams.get("ceiling") ?? "80";
  if (!["80", "85", "90"].includes(raw))
    return NextResponse.json(
      { error: "Choose 80, 85 or 90 km." },
      { status: 400 },
    );
  return NextResponse.json(
    planningPolicyReview(getDatabase(), Number(raw) as 80 | 85 | 90),
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 1024)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    return NextResponse.json(
      savePlanningPolicy(getDatabase(), JSON.parse(text)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof PlanningPolicyError
            ? e.message
            : "Review a valid ceiling before applying it.",
      },
      { status: e instanceof PlanningPolicyError ? e.status : 400 },
    );
  }
}
