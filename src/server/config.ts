import { z } from "zod";

const envSchema = z.object({
  APP_SESSION_SECRET: z.string().min(16),
  GARMIN_PERSONAL_API_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().optional(),
  ),
  OPENAI_API_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().optional(),
  ),
  OPENAI_MODEL: z.string().default("gpt-6-luna"),
  SYNC_SECRET: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(16).optional(),
  ),
  DATABASE_PATH: z.string().default("./data/coach.db"),
});

const garminEnvSchema = envSchema.omit({ APP_SESSION_SECRET: true });

export function getConfig() {
  return envSchema.parse({
    APP_SESSION_SECRET: process.env.APP_SESSION_SECRET,
    GARMIN_PERSONAL_API_KEY: process.env.GARMIN_PERSONAL_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    SYNC_SECRET: process.env.SYNC_SECRET,
    DATABASE_PATH: process.env.DATABASE_PATH,
  });
}

export function getGarminConfig() {
  return garminEnvSchema.parse({
    GARMIN_PERSONAL_API_KEY: process.env.GARMIN_PERSONAL_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    SYNC_SECRET: process.env.SYNC_SECRET,
    DATABASE_PATH: process.env.DATABASE_PATH,
  });
}
