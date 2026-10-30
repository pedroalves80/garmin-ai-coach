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
};
