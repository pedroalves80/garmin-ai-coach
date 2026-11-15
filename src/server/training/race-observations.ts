import type { Commitments } from "../../shared/types/commitments";
import type { ActivityMeasurement } from "../../shared/types/metrics";
import { sportGroup } from "./metrics";
import { calendarDate } from "./dates";
// A matching recording informs the estimate; it does not prove race effort or recovery.
export function observeRaces(
  commitments: Commitments,
  activities: ActivityMeasurement[],
  now: Date,
): Commitments {
  const today = calendarDate(now);
  return {
    ...commitments,
    races: commitments.races.map((r) => {
      if (r.status === "cancelled" || r.day > today) return r;
      const match = activities
        .filter(
          (a) =>
            sportGroup(a) === "running" &&
            Date.parse(a.startedAt) <= now.getTime() &&
            calendarDate(new Date(a.startedAt)) === r.day &&
            (a.distanceMeters ?? 0) >= r.distanceKm * 900 &&
            (a.distanceMeters ?? 0) <= r.distanceKm * 1500 &&
            (a.durationSeconds ?? 0) > 0 &&
            (!a.mileageRaceId || a.mileageRaceId === r.id),
        )
        .sort(
          (a, b) =>
            Number(b.mileageRaceId === r.id) -
              Number(a.mileageRaceId === r.id) ||
            Math.abs((a.distanceMeters ?? 0) / 1000 - r.distanceKm) -
              Math.abs((b.distanceMeters ?? 0) / 1000 - r.distanceKm),
        )[0];
      return match
        ? {
            ...r,
            recorded: {
              activityId: match.id,
              km: match.distanceMeters! / 1000,
              minutes: match.durationSeconds! / 60,
            },
          }
        : r;
    }),
  };
}
