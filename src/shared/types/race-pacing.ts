export type RacePaceEvidence = {
  id: string;
  day: string;
  source: "garmin_prediction" | "road_race" | "road_test";
  distanceKm: number;
  seconds: number;
  updatedAt: string;
};
export type RacePaceAdvice = {
  raceId: string;
  day: string;
  terrain: "road" | "trail";
  confidence: "low" | "moderate" | "none";
  status: "provisional" | "insufficient" | "trail" | "conflict" | "training";
  reference: RacePaceEvidence | null;
  predictedSeconds: number | null;
  predictedPace: number | null;
  range: { min: number; max: number } | null;
  notes: string[];
};
