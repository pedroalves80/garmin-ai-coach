import { NextResponse } from "next/server";
import { z } from "zod";
import { requestHost } from "@/server/security/local-host";
import { authorizeMutation } from "@/server/security/authorize";
import { getDatabase } from "@/server/db/client";
import {
  ScheduleEditingService,
  scheduleEditSchema,
  ScheduleEditError,
} from "@/server/training/rescheduling";
import { ScheduleRuleError } from "@/shared/weekly-schedule";

const requestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("preview"), change: scheduleEditSchema }).strict(),
  z
    .object({
      mode: z.literal("apply"),
      change: scheduleEditSchema,
      revision: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      mode: z.literal("suggest"),
      day: z.iso.date(),
      sessionId: z.string().min(1).max(180),
      reason: z.enum(["unavailable", "tired", "other"]),
    })
    .strict(),
]);
function failure(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof ScheduleEditError || error instanceof ScheduleRuleError
          ? error.message
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? "Choose a valid workout change and preview it before applying."
            : "Could not change this schedule. Refresh and try again.",
    },
    {
      status: error instanceof ScheduleEditError ? error.status : 400,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export async function GET(request: Request) {
  // Plain HTTP LAN browsers omit Origin and Fetch Metadata on same-origin GETs.
  // The non-simple app header requires a CORS preflight from foreign pages;
  // no foreign origin is allowed. Retain the existing host/origin/site checks.
  const headers = new Headers(request.headers);
  if (!headers.has("origin") && headers.get("x-coach-request") === "local")
    headers.set(
      "origin",
      `${new URL(request.url).protocol}//${requestHost(request)}`,
    );
  const denied = authorizeMutation(new Request(request.url, { headers }));
  if (denied) return denied;
  try {
    const week = z.iso
      .date()
      .parse(new URL(request.url).searchParams.get("week"));
    return NextResponse.json(
      new ScheduleEditingService(getDatabase()).catalog(week),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 8192)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const input = requestSchema.parse(JSON.parse(text)),
      service = new ScheduleEditingService(getDatabase());
    const result =
      input.mode === "preview"
        ? service.preview(input.change)
        : input.mode === "apply"
          ? service.apply(input.change, input.revision)
          : service.suggest(input.day, input.sessionId, input.reason);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
