import type { RunWorkout, PlanTarget } from "./metrics";
export type PrescriptionSnapshot = {
  id: string;
  sequence: number;
  sessionKey: string;
  day: string;
  capturedAt: string;
  workout: RunWorkout | null;
  easyPace: number;
  planStart: string;
  source: "approved" | "change" | "observed" | "legacy";
  signature: string;
};
export type SessionFeeling = "easier" | "right" | "harder";
export type ReviewStep = {
  name: string;
  plannedMeters: number;
  target: PlanTarget;
  recordedMeters: number | null;
  averageHr: number | null;
  averagePace: number | null;
  state:
    | "unknown"
    | "average_inside"
    | "average_outside"
    | "distance_differs"
    | "effort_only";
  note: string;
};
export type WorkoutReview = {
  activityId: string;
  day: string;
  name: string;
  km: number;
  countedKm: number;
  minutes: number;
  averageHr: number | null;
  match: "automatic" | "manual" | "suggested" | "unplanned" | "ambiguous";
  snapshot: PrescriptionSnapshot | null;
  plannedKm: number | null;
  distanceStatus: "met" | "partial" | "over" | "unknown";
  versionKnown: boolean;
  feeling: SessionFeeling | null;
  detailStatus: string;
  attachedWorkout: boolean;
  steps: ReviewStep[];
  notes: string[];
  choices: PrescriptionSnapshot[];
  manualChoice: boolean;
};
export type FitnessEvidence = {
  id: string;
  kind: "threshold" | "base_observation";
  observedOn: string | null;
  reportedAt: string;
  archivedAt: string | null;
  source: "garmin_estimate" | "field_test" | "lab_test" | "self_report";
  heartRate: number;
  paceSeconds: number | null;
  powerWatts: number | null;
  wattsPerKg: number | null;
  comfortableTalk: boolean | null;
  controlledBreathing: boolean | null;
  device: string;
  sensor: string;
};

export type FitnessEvidenceSummary = {
  threshold: {
    source: FitnessEvidence["source"];
    observedOn: string | null;
    reportedOn: string;
    hr: number;
    pace: number | null;
    runningPower: number | null;
  } | null;
  base: {
    source: FitnessEvidence["source"];
    observedOn: string | null;
    reportedOn: string;
    hr: number;
    comfortableTalk: boolean | null;
    controlledBreathing: boolean | null;
  } | null;
};
