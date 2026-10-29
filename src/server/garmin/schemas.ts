import { z } from "zod";

// Subset of Garmin Personal API v1.0.0. Unknown fields are retained locally.
export const calendarDay = z.iso.date();
const measurement = z.number().finite().nonnegative().nullish();
const heartRate = z.number().finite().min(0).max(300).nullish();
const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  .transform((v) => v.replace(" ", "T") + "Z")
  .pipe(z.iso.datetime());

export const activitySchema = z
  .object({
    activityId: z.union([
      z.number().int().positive().safe(),
      z.string().regex(/^\d+$/),
    ]),
    activityName: z.string().nullish(),
    startTimeGMT: timestamp,
    activityType: z.object({ typeKey: z.string().min(1) }).passthrough(),
    distance: measurement,
    duration: measurement,
    averageHR: heartRate,
    maxHR: heartRate,
  })
  .passthrough();

export const sleepSchema = z
  .object({
    calendarDate: calendarDay,
    sleepTimeSeconds: z.number().int().min(0).max(86400).nullish(),
  })
  .passthrough();

export const healthSchema = z
  .object({
    calendarDate: calendarDay,
    heartRate: z.object({ restingValue: heartRate }).passthrough().nullish(),
    bodyBattery: z
      .object({ latestValue: z.number().int().min(0).max(100).nullish() })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export const activityPage = z.array(activitySchema);
export const healthPage = z
  .object({ data: z.array(healthSchema) })
  .passthrough();
export const sleepPage = z.array(sleepSchema);
export type GarminActivity = z.infer<typeof activitySchema>;
export type GarminHealth = z.infer<typeof healthSchema>;
export type GarminSleep = z.infer<typeof sleepSchema>;

export class GarminPayloadError extends Error {
  constructor() {
    super(
      "Garmin returned an unexpected data format; the sync checkpoint was not advanced.",
    );
  }
}

export function parsePayload<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new GarminPayloadError();
  return result.data;
}
