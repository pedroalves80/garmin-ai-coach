import type { CoachContext } from "@/server/coach/coach-service";

export function shouldRest(context: CoachContext): boolean {
  return Boolean(context.painReported) || context.recentHardSessions >= 2;
}
