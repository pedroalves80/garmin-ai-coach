import type { RunWorkout } from "./metrics";

export type CoachKind = "today" | "weekly";
export type CoachAction = "follow" | "shorten" | "easy" | "rest";
export type CoachReview = {
  id: string;
  kind: CoachKind;
  day: string;
  createdAt: string;
  model: string;
  contextHash: string;
  summary: string;
  observations: string[];
  action: CoachAction;
  reason: string;
  constraints: string[];
  proposal: { before: RunWorkout; after: RunWorkout | null } | null;
  usage: { inputTokens: number; outputTokens: number };
};
export type CoachStatus = {
  configured: boolean;
  model: string;
  dailyUsed: number;
  monthlyUsed: number;
  dailyLimit: number;
  monthlyLimit: number;
  reviews: CoachReview[];
  accepted: { day: string; reviewId: string } | null;
};
