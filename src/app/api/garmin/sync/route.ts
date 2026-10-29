import { NextResponse } from "next/server";
import { getGarminConfig } from "@/server/config";
import { syncGarminData } from "@/server/garmin/sync";

export async function POST(request: Request) {
  const config = getGarminConfig();
  if (!config.SYNC_SECRET || request.headers.get("x-sync-secret") !== config.SYNC_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await syncGarminData()); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 502 }); }
}
