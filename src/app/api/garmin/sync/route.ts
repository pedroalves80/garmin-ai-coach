import { NextResponse } from "next/server";
import { getGarminConfig } from "@/server/config";
import { syncGarminData } from "@/server/garmin/service";
import { SyncBusyError } from "@/server/db/garmin-repository";
import { timingSafeEqual } from "node:crypto";

export async function POST(request: Request) {
  const config = getGarminConfig();
  const expected = Buffer.from(config.SYNC_SECRET ?? "");
  const supplied = Buffer.from(request.headers.get("x-sync-secret") ?? "");
  if (
    !expected.length ||
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return NextResponse.json({ error: "Origin rejected" }, { status: 403 });
  if (!config.GARMIN_PERSONAL_API_KEY)
    return NextResponse.json(
      { error: "Garmin is not configured on the server." },
      { status: 503 },
    );
  try {
    return NextResponse.json(
      await syncGarminData(
        new URL(request.url).searchParams.get("full") === "true",
      ),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: error instanceof SyncBusyError ? 409 : 502 },
    );
  }
}
