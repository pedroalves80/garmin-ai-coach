export type AutomaticRaceRecovery = {
  status: "recovery" | "base";
  checkedOn: string;
  from: string;
  revision: string;
  recordingRevision: string | null;
  recoveryRuns: number;
  lastRunDay: string | null;
  healthDay: string | null;
  paceComparison: "unavailable" | "no_concern" | "caution";
  reasons: string[];
};
export type RaceEvent = {
  id: string;
  name: string;
  day: string;
  startTime: string | null;
  distanceKm: number;
  terrain: "road" | "trail";
  elevationGain: number | null;
  expectedMinutes: number;
  priority: "goal" | "training";
  status: "planned" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  participationReview?: {
    previousId: string;
    previousRevision: string;
    revision: string;
    reviewedAt: string;
  };
  recoveryReview?: {
    revision: string;
    from: string;
    reviewedAt: string;
    activityId: string;
    recordingRevision: string;
  };
  // Derived on read from current evidence. Never stored as an athlete review.
  automaticRecovery?: AutomaticRaceRecovery;
  recorded?: { activityId: string; km: number; minutes: number };
};
export type TrainingPause = {
  id: string;
  start: string;
  end: string | null;
  reason: "travel" | "illness" | "injury" | "rest";
  cancelled: boolean;
  resumeOn: string | null;
  returnReviewedAt: string | null;
  baselineReviewedAt?: string | null;
  staleWeeks?: string[];
  createdAt: string;
};
export type Commitments = { races: RaceEvent[]; pauses: TrainingPause[] };
export type CalendarRule = {
  phase:
    | "paused"
    | "return_review"
    | "return"
    | "race"
    | "taper"
    | "race_recovery"
    | "race_week";
  notes: string[];
  provisional?: boolean;
  recoveryEffort?: "recovery" | "base";
  recoverySource?: "automatic" | "manual";
};
