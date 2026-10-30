import type { RunWorkout } from "./metrics";
import type { ScheduleChange } from "./schedule";

export type CoachKind = "today" | "weekly";
export type CoachAction =
  | "follow"
  | "shorten"
  | "easy"
  | "rest"
  | "cycle"
  | "skip_secondary"
  | "move_0"
  | "move_1"
  | "move_2"
  | "move_3"
  | "move_4"
  | "move_5";
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
  scheduleChanges?: ScheduleChange[];
  usage: { inputTokens: number; outputTokens: number };
  appliedContextHash?: string;
};
export type CoachStatus = {
  configured: boolean;
  contextHash?: string;
  model: string;
  dailyUsed: number;
  monthlyUsed: number;
  dailyLimit: number;
  monthlyLimit: number;
  reviews: CoachReview[];
  accepted: { day: string; reviewId: string } | null;
  automatic?: {
    enabled: boolean;
    attemptedAt: string | null;
    error: string | null;
  };
};
