import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getGarminConfig } from "@/server/config";
import { db } from "@/server/db/client";
import { activities, syncState } from "@/server/db/schema";

export function GET() {
  const config = getGarminConfig();
  const state = db.select().from(syncState).where(eq(syncState.provider, "garmin")).get();
  const latest = db.select({ startedAt: activities.startedAt }).from(activities).orderBy(desc(activities.startedAt)).limit(1).get();
  return NextResponse.json({ configured: Boolean(config.GARMIN_PERSONAL_API_KEY), lastSync: state?.lastCompletedAt ?? null, lastError: state?.lastError ?? null, latestActivity: latest?.startedAt ?? null });
}
