import type { PlanStep, RunWorkout } from "./types/metrics";
// Existing level meanings are preserved for approved historical plans.
export const TEMPO_LEVELS = [
  [2, 1000],
  [2, 1300],
  [3, 1000],
  [2, 1800],
  [3, 1400],
  [2, 2400],
  [3, 1800],
] as const;
export function tempoLevelMeters(level: number) {
  const [reps, meters] = TEMPO_LEVELS[Math.max(0, Math.min(6, level))];
  return reps * meters;
}
export function tempoWork(workout: RunWorkout) {
  const rows: { meters: number; min: number; max: number }[] = [];
  function visit(steps: PlanStep[], multiple = 1, depth = 0) {
    if (depth > 4) return;
    for (const s of steps) {
      if (s.kind === "repeat")
        visit(s.steps, multiple * Math.min(20, s.times), depth + 1);
      else if (
        s.name === "Run" &&
        s.target.kind === "pace" &&
        s.amount.kind === "distance"
      )
        rows.push({
          meters: s.amount.meters * multiple,
          min: s.target.min,
          max: s.target.max,
        });
    }
  }
  if (workout.type !== "quality" || workout.race || workout.trail) return null;
  visit(workout.steps);
  if (
    !rows.length ||
    rows.some((s) => s.min !== rows[0].min || s.max !== rows[0].max)
  )
    return null;
  return {
    meters: rows.reduce((n, s) => n + s.meters, 0),
    min: rows[0].min,
    max: rows[0].max,
  };
}
// Planning limits, not a validated safe-load formula. Never force a larger session to fit.
export function tempoLevelForVolume(level: number, km: number) {
  let next = Math.max(0, Math.min(6, level));
  while (next > 0 && tempoLevelMeters(next) > Math.max(2000, km * 100) + 0.01)
    next--;
  return next;
}
export function forecastTempoLevel(
  anchorStage: number,
  anchorLevel: number,
  stage: number,
) {
  let opportunities = 0;
  for (let s = anchorStage + 1; s <= stage; s++)
    if (s % 4 !== 0 && s % 4 !== 1) opportunities++;
  return Math.min(6, anchorLevel + Math.floor(opportunities / 2));
}
