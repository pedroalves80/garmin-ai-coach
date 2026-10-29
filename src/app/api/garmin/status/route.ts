import { connection, NextResponse } from "next/server";
import { getGarminConfig } from "@/server/config";
import { getDatabase } from "@/server/db/client";
import { GarminRepository } from "@/server/db/garmin-repository";
import { autoSyncStatus } from "@/server/garmin/scheduler";

export async function GET() {
  await connection();
  const config = getGarminConfig();
  const repository = new GarminRepository(getDatabase());
  const state = repository.status();
  return NextResponse.json(
    {
      configured: Boolean(config.GARMIN_PERSONAL_API_KEY),
      running: repository.isRunning(),
      lastSync: state?.lastCompletedAt ?? null,
      lastError: state?.lastError ?? null,
      automatic: autoSyncStatus(getDatabase(), config.GARMIN_AUTO_SYNC),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
