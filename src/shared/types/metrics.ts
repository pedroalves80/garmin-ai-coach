export type ActivityMeasurement = {
  id: string;
  name: string | null;
  sportType: string;
  startedAt: string;
  durationSeconds: number | null;
  distanceMeters: number | null;
  averageHeartRate: number | null;
  rawJson: string;
  excludedRaceMeters?: number;
  mileageRaceId?: string | null;
};

export type DailyCheckIn = {
  day: string;
  fatigue: number;
  soreness: number;
  pain: number;
  notes: string;
};

export type TrainingWeek = {
  start: string;
  partial: boolean;
  runningKm: number;
  totalRunningKm?: number;
  raceExtraKm?: number;
  runningMinutes: number;
  runs: number;
  cyclingMinutes: number;
  hyroxMinutes: number;
  otherMinutes: number;
  wellnessMinutes: number;
  longestKm: number;
};

export type PlanTarget =
  | { kind: "hr"; min: number; max: number }
  | { kind: "pace"; min: number; max: number }
  | { kind: "effort"; min: number; max: number };

export type PlanStep =
  | {
      kind: "step";
      name: "Warm Up" | "Run" | "Recover" | "Cool Down";
      amount:
        | { kind: "distance"; meters: number }
        | { kind: "time"; seconds: number };
      target: PlanTarget;
    }
  | { kind: "repeat"; times: number; steps: PlanStep[] };

export type RunWorkout = {
  dayOffset: number;
  title: string;
  type: "base" | "strides" | "quality" | "long" | "recovery" | "race";
  race?: import("./commitments").RaceEvent;
  calendarAdjustment?: { raceId: string; phase: "preparation" };
  trail?: {
    expectedMinutes: number;
    ascentM?: number;
    road?: { title: string; steps: PlanStep[] };
  };
  steps: PlanStep[];
};

export type TrainingPlan = {
  policy?: import("../training-cycle").PlanningPolicy;
  planningVersion?: 2;
  development?: import("./athlete").PlanDevelopment;
  weekNumber: number;
  start: string;
  targetKm: number;
  easyPace: number;
  tempoPace: number;
  cutback: boolean;
  workouts: RunWorkout[];
};

export type ProgressionDecision = {
  decision: "increase" | "hold" | "reduce";
  reasons: string[];
  suggestedKm: number | null;
};
