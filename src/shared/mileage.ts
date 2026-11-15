import type { ActivityMeasurement, RunWorkout } from "./types/metrics";
import type { WeekSchedule } from "./types/schedule";
import { workoutKm } from "./training-plan";

export function raceExtraMeters(activity: ActivityMeasurement) {
  return Math.max(
    0,
    Math.min(activity.distanceMeters ?? 0, activity.excludedRaceMeters ?? 0),
  );
}
export function countedActivityKm(activity: ActivityMeasurement) {
  return (
    Math.max(0, (activity.distanceMeters ?? 0) - raceExtraMeters(activity)) /
    1000
  );
}
// Race extras stay in workout steps, minutes and physical load, outside the mileage target.
export function workoutMileageKm(workout: RunWorkout, easyPace: number) {
  return workout.race ? workout.race.distanceKm : workoutKm(workout, easyPace);
}
export function calendarMileage(calendar: WeekSchedule, easyPace: number) {
  const runs = calendar.days
    .flatMap((d) => d.sessions)
    .flatMap((s) => (s.session.sport === "running" ? [s.session.workout] : []));
  const countedKm = runs.reduce((n, w) => n + workoutMileageKm(w, easyPace), 0);
  const totalKm = runs.reduce((n, w) => n + workoutKm(w, easyPace), 0);
  return { countedKm, totalKm, raceExtrasKm: Math.max(0, totalKm - countedKm) };
}
