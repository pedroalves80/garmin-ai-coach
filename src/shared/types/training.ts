export type WorkoutTarget = { kind: "heart_rate"; min: number; max: number } | { kind: "pace"; minSecondsPerKm: number; maxSecondsPerKm: number };
export type WorkoutStepDefinition = { name: string; durationSeconds: number; target: WorkoutTarget };
export type PlannedWorkout = { id: string; date: string; title: string; sport: "run" | "cycle" | "hyrox"; steps: WorkoutStepDefinition[] };
