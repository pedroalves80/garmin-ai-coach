import type Database from "better-sqlite3";
import { z } from "zod";
import { prepare } from "../db/statements";
import { GarminRepository } from "../db/garmin-repository";
import { CommitmentRepository } from "./commitment-repository";
import { sportGroup } from "./metrics";
import { calendarDate } from "./dates";
import { daysBetween } from "../../shared/commitment-calendar";
export class MileageError extends Error {}
export const mileageInput = z
  .object({
    activityId: z.string().min(1).max(128),
    raceId: z.uuid().nullable(),
    excludedKm: z.number().finite().min(0).max(100),
    confirmed: z.literal(true),
  })
  .strict();
export function saveRaceExtras(
  db: Database.Database,
  raw: unknown,
  now = new Date(),
) {
  const input = mileageInput.parse(raw);
  const activity = new GarminRepository(db)
    .allActivities()
    .find((a) => a.id === input.activityId);
  if (
    !activity ||
    sportGroup(activity) !== "running" ||
    Date.parse(activity.startedAt) > now.getTime()
  )
    throw new MileageError(
      "Choose a recorded dedicated run. Hyrox and cycling never count towards running mileage.",
    );
  const meters = input.excludedKm * 1000;
  if (meters > (activity.distanceMeters ?? 0) + 0.01)
    throw new MileageError(
      "Excluded kilometres cannot exceed the recorded distance.",
    );
  if (meters > 0) {
    const race = new CommitmentRepository(db)
      .all()
      .races.find((r) => r.id === input.raceId && r.status !== "cancelled");
    if (
      !race ||
      Math.abs(
        daysBetween(calendarDate(new Date(activity.startedAt)), race.day),
      ) > 1
    )
      throw new MileageError(
        "Associate race warm-up/cool-down with its event on the same or adjacent date.",
      );
  }
  prepare(
    db,
    "INSERT INTO activity_mileage(activity_id,race_id,excluded_meters,updated_at) VALUES(?,?,?,?) ON CONFLICT(activity_id) DO UPDATE SET race_id=excluded.race_id,excluded_meters=excluded.excluded_meters,updated_at=excluded.updated_at",
  ).run(activity.id, meters ? input.raceId : null, meters, now.toISOString());
  return { saved: true };
}
