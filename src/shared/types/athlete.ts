export type RunningTargets = {
  baseMin: number;
  baseMax: number;
  recoveryMin: number;
  recoveryMax: number;
  longMin: number;
  longMax: number;
  strideMin: number;
  strideMax: number;
};
export type AthleteProfile = {
  goal: "aerobic_running";
  easyPace: number;
  tempoPace: number;
  targets: RunningTargets;
  calibrationSource: "provisional" | "field_test" | "lab_test" | "coach_review";
  reviewedAt: string | null;
  evidence: string;
};
export type PlanDevelopment = {
  phase:
    "volume" | "quality" | "consolidate" | "cutback" | "recovery" | "return";
  qualityLevel: number;
  reason: string;
  targets: RunningTargets;
  reviewedAt: string | null;
};
export type SessionEffort = {
  activityId: string;
  rpe: number;
  prescriptionCompleted?: boolean;
};
export const DEFAULT_TARGETS: RunningTargets = {
  baseMin: 135,
  baseMax: 148,
  recoveryMin: 125,
  recoveryMax: 140,
  longMin: 135,
  longMax: 150,
  strideMin: 240,
  strideMax: 270,
};
export const DEFAULT_ATHLETE: AthleteProfile = {
  goal: "aerobic_running",
  easyPace: 375,
  tempoPace: 270,
  targets: DEFAULT_TARGETS,
  calibrationSource: "provisional",
  reviewedAt: null,
  evidence: "",
};
