import { NextResponse, connection } from "next/server";
import { z } from "zod";
import { authorizeMutation } from "@/server/security/authorize";
import { getConfig } from "@/server/config";
import { coachService } from "@/server/coach/runtime";
import { CoachError } from "@/server/coach/service";

const actionSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("review"), kind: z.enum(["today", "weekly"]) })
    .strict(),
  z.object({ action: z.literal("accept"), id: z.uuid() }).strict(),
]);
export async function GET() {
  await connection();
  return NextResponse.json(
    coachService().status(!!getConfig().OPENAI_API_KEY),
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > 1024)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const parsed = actionSchema.safeParse(JSON.parse(body));
    if (!parsed.success)
      return NextResponse.json(
        { error: "Choose a review or a saved proposal to approve." },
        { status: 400 },
      );
    const input = parsed.data,
      service = coachService();
    if (input.action === "review" && !getConfig().OPENAI_API_KEY)
      throw new CoachError(
        "Set OPENAI_API_KEY in the server's .env and restart to enable coaching.",
        503,
      );
    return NextResponse.json(
      input.action === "review"
        ? await service.review(input.kind)
        : service.accept(input.id),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof CoachError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: "Invalid JSON request." },
        { status: 400 },
      );
    return NextResponse.json(
      {
        error:
          "The coach could not process this request. No workout was changed.",
      },
      { status: 500 },
    );
  }
}
