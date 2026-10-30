import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeMutation } from "@/server/security/authorize";
import { getDatabase } from "@/server/db/client";
import {
  ScheduleRepository,
  preferencesSchema,
  weekPreferencesSchema,
} from "@/server/training/schedule-repository";
import { TrainingRepository } from "@/server/training/repository";
import { GarminRepository } from "@/server/db/garmin-repository";
import { calendarDate, mondayOf, shiftDay } from "@/server/training/dates";
import { moveRunningDay } from "@/server/training/calendar";
import {
  validateDaySessions,
  buildWeekSchedule,
  ScheduleRuleError,
} from "@/shared/weekly-schedule";

const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("preferences"),
      preferences: preferencesSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("week"),
      start: z.iso.date(),
      preferences: weekPreferencesSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("move"),
      start: z.iso.date(),
      from: z.number().int().min(0).max(5),
      to: z.number().int().min(0).max(5),
    })
    .strict(),
]);
export async function POST(request: Request) {
  const denied = authorizeMutation(request);
  if (denied) return denied;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 4096)
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success)
      return NextResponse.json(
        { error: "Choose valid preferences or a Monday–Saturday move." },
        { status: 400 },
      );
    const input = parsed.data,
      db = getDatabase(),
      repository = new ScheduleRepository(db),
      now = new Date();
    if (input.action === "preferences")
      repository.savePreferences(input.preferences);
    else {
      const monday = mondayOf(calendarDate(now));
      if (
        mondayOf(input.start) !== input.start ||
        input.start < monday ||
        input.start > shiftDay(monday, 210)
      )
        throw new ScheduleRuleError(
          "Choose this week or a future Monday within 30 weeks.",
        );
      if (input.action === "week")
        db.transaction(() => {
          const changes = repository.changes(input.start);
          const plan = new TrainingRepository(db)
            .plans()
            .find((p) => p.start === input.start);
          repository.saveWeek(input.start, input.preferences);
          if (plan) {
            const next = buildWeekSchedule(
              plan,
              input.preferences,
              repository.preferences(),
            );
            // Attendance edits can change supporting training without restoring a moved/reduced run.
            repository.saveChanges(
              changes.map((change) => ({
                day: change.day,
                sessions:
                  change.sessions.length === 0 || change.day < calendarDate(now)
                    ? change.sessions
                    : [
                        ...change.sessions.filter((s) => s.sport === "running"),
                        ...(next.days
                          .find((d) => d.day === change.day)
                          ?.sessions.filter(
                            (s) => s.session.sport !== "running",
                          )
                          .map((s) => s.session) ?? []),
                      ],
              })),
              null,
            );
          }
        })();
      else {
        const plan = new TrainingRepository(db)
          .plans()
          .find((p) => p.start === input.start);
        if (!plan)
          throw new ScheduleRuleError(
            "Save the reviewed week before moving a run.",
          );
        db.transaction(() => {
          const changes = moveRunningDay(
            db,
            plan,
            input.from,
            input.to,
            new GarminRepository(db).allActivities(),
            now,
          );
          for (const change of changes)
            validateDaySessions(
              new Date(`${change.day}T12:00:00Z`).getUTCDay() === 0
                ? 6
                : (new Date(`${change.day}T12:00:00Z`).getUTCDay() + 6) % 7,
              change.sessions,
              plan.easyPace,
            );
          repository.saveChanges(changes, null);
        })();
      }
    }
    return NextResponse.json(
      { saved: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ScheduleRuleError
            ? error.message
            : "Could not save this schedule. Check the inputs and retry.",
      },
      { status: 400 },
    );
  }
}
