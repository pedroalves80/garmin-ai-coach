import type { PlannedWorkout } from "@/shared/types/training";

export type CoachContext = {
  weeklyRunKm: number;
  targetRunKm: number;
  recentHardSessions: number;
  sleepAverageHours?: number;
  painReported?: boolean;
};
export type CoachRecommendation = {
  decision: "follow" | "reduce" | "replace" | "rest";
  reason: string;
  workout?: PlannedWorkout;
  warnings: string[];
};

export async function getCoachRecommendation(
  _context: CoachContext,
): Promise<CoachRecommendation> {
  void _context;
  throw new Error(
    "Coach service not configured yet. Add the server-side OpenAI adapter in Phase 2.",
  );
}
