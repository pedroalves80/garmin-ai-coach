import { z } from "zod";
import { raceSchema } from "./commitment-repository";
import { runningTargetsSchema } from "./athlete-repository";
import type { PlanStep, TrainingPlan } from "../../shared/types/metrics";

export const checkInSchema = z
  .object({
    day: z.iso.date(),
    fatigue: z.number().int().min(1).max(5),
    soreness: z.number().int().min(1).max(5),
    pain: z.number().int().min(0).max(10),
    notes: z.string().trim().max(300).default(""),
  })
  .strict();

export const planSettingsSchema = z
  .object({
    weekNumber: z.number().int().min(1).max(30),
    targetKm: z.number().min(20).max(80).multipleOf(0.01).optional(),
    start: z.iso
      .date()
      .refine(
        (day) => new Date(`${day}T12:00:00Z`).getUTCDay() === 1,
        "Choose a Monday",
      ),
    easyPace: z.number().int().min(240).max(600),
    tempoPace: z.number().int().min(180).max(420),
  })
  .strict();

const targetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("effort"),
    min: z.number().int().min(1).max(10),
    max: z.number().int().min(1).max(10),
  }),
  z.object({
    kind: z.literal("hr"),
    min: z.number().min(40).max(230),
    max: z.number().min(40).max(230),
  }),
  z.object({
    kind: z.literal("pace"),
    min: z.number().positive(),
    max: z.number().positive(),
  }),
]);
const stepSchema: z.ZodType<PlanStep> = z.lazy(() =>
  z.union([
    z.object({
      kind: z.literal("step"),
      name: z.enum(["Warm Up", "Run", "Recover", "Cool Down"]),
      amount: z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("distance"),
          meters: z.number().positive(),
        }),
        z.object({ kind: z.literal("time"), seconds: z.number().positive() }),
      ]),
      target: targetSchema,
    }),
    z.object({
      kind: z.literal("repeat"),
      times: z.number().int().min(1).max(20),
      steps: z.array(stepSchema).min(1),
    }),
  ]),
);
export const savedPlanSchema: z.ZodType<TrainingPlan> =
  planSettingsSchema.extend({
    targetKm: z.number().min(20).max(80),
    cutback: z.boolean(),
    development: z
      .object({
        phase: z.enum([
          "volume",
          "quality",
          "consolidate",
          "cutback",
          "recovery",
          "return",
        ]),
        qualityLevel: z.number().int().min(0).max(6),
        reason: z.string().max(500),
        targets: runningTargetsSchema,
        reviewedAt: z.iso.date().nullable(),
      })
      .optional(),
    workouts: z
      .array(
        z.object({
          dayOffset: z.number().int().min(0).max(6),
          title: z.string(),
          type: z.enum([
            "base",
            "strides",
            "quality",
            "long",
            "recovery",
            "race",
          ]),
          race: raceSchema.optional(),
          trail: z
            .object({
              expectedMinutes: z.number().int().min(15).max(1440),
              ascentM: z.number().int().min(0).max(10000).optional(),
              road: z
                .object({
                  title: z.string(),
                  steps: z.array(stepSchema).min(1),
                })
                .optional(),
            })
            .optional(),
          steps: z.array(stepSchema).min(1),
        }),
      )
      .min(1),
  });
