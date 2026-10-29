import { NextResponse } from "next/server";
import { getGarminConfig } from "@/server/config";
import { syncGarminData } from "@/server/garmin/service";
import { SyncBusyError } from "@/server/db/garmin-repository";
import { authorizeMutation } from "@/server/security/authorize";

export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  const config = getGarminConfig();
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
