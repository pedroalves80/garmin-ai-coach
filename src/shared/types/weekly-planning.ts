import type { FitnessEvidenceSummary } from "./workout-review";
import type { RacePaceAdvice } from "./race-pacing";
import type { TrainingPlan, TrainingWeek } from "./metrics";
import type { WeekPreferences, WeekSchedule } from "./schedule";

export type RecoveryEvidence = {
  status: "supportive" | "caution" | "unknown";
  latestDay: string | null;
  recentRestingHr: number | null;
  baselineRestingHr: number | null;
  recentSleepHours: number | null;
  recentDays: number;
  notes: string[];
};
export type WeeklyReductionReason =
  | "recovery_caution"
  | "reported_recovery"
  | "supporting_increase"
  | "combined_load"
  | "planned_load"
  | "incomplete_running"
  | "stale_data"
  | "calendar_restriction";
export type SupportingWorkload = {
  recentMinutes: number;
  baselineMinutes: number | null;
  baselineWeeks: number;
  change: number | null;
  increased: boolean;
};
export type WeeklySelectionPolicy = {
  supportingWorkload: SupportingWorkload;
  reductionEvidence: { code: WeeklyReductionReason; detail: string }[];
};
export type WeeklyOptionId = "recommended" | "consolidate" | "recovery";
export type WeeklyPlanOption = {
  id: WeeklyOptionId;
  plan: TrainingPlan;
  preferences: WeekPreferences;
  calendar: WeekSchedule;
  rebalanced?: boolean;
};
export type WeeklyPlanning = {
  workoutReview?: {
    runs: number;
    matched: number;
    needsMatch: number;
    distanceMet: number;
    partial: number;
    intensityUnknown: number;
    averagesOutside: number;
    easier: number;
    right: number;
    harder: number;
  };
  fitnessEvidence?: FitnessEvidenceSummary;
  racePaceAdvice: RacePaceAdvice[];
  start: string;
  token: string;
  evidenceHash: string;
  needsApproval: boolean;
  correction?: { savedStage: number; expectedStage: number };
  blockedReason: string | null;
  reference: {
    start: string;
    stage: number;
    plannedKm: number;
    recordedKm: number;
    runs: number;
  } | null;
  history: {
    weeks: TrainingWeek[];
    sessions: {
      day: string;
      sport: string;
      km: number;
      minutes: number;
      averageHeartRate: number | null;
      paceSecondsPerKm: number | null;
      aerobicTrainingEffect: number | null;
      trainingLoad: number | null;
    }[];
    ratedCoverage: number;
  };
  recovery: RecoveryEvidence;
  source: "local" | "ai";
  aiStatus:
    | "pending"
    | "ready"
    | "unavailable"
    | "refreshed"
    | "corrected"
    | "disabled";
  summary: string;
  observations: string[];
  reasons: string[];
  selected: WeeklyPlanOption;
  options: WeeklyPlanOption[];
  selectionPolicy: WeeklySelectionPolicy;
  performance: {
    pairs: number;
    secondsPerKmChange: number | null;
    weatherMissing: boolean;
  };
};
