import type { CoachAction, CoachKind } from "../../shared/types/coach";
import type { RunWorkout } from "../../shared/types/metrics";
import { workoutKm, minimumRunKm } from "../../shared/training-plan";
import type { CoachData } from "./context";
import { allowedActions } from "./context";
import type {
  ScheduleChange,
  TrainingSession,
} from "../../shared/types/schedule";
import {
  cyclingWorkout,
  validateDaySessions,
} from "../../shared/weekly-schedule";

export function workoutProposal(
  context: CoachData,
  kind: CoachKind,
  action: CoachAction,
) {
  if (!allowedActions(context, kind).includes(action))
    throw new Error(
      "The recommendation conflicts with the local training rules.",
    );
  if (
    kind !== "today" ||
    action === "follow" ||
    !["shorten", "easy", "rest"].includes(action) ||
    !context.canAdjust ||
    !context.workout ||
    !context.plan
  )
    return null;
  const before = context.workout;
  let after: RunWorkout | null = null;
  if (action !== "rest") {
    const meters = Math.max(
      minimumRunKm * 1000,
      Math.floor(
        (workoutKm(before, context.plan.easyPace) *
          1000 *
          (action === "shorten" ? 0.8 : 1)) /
          10,
      ) * 10,
    );
    after = {
      dayOffset: before.dayOffset,
      title: before.trail
        ? "Reduced trail recovery run"
        : action === "shorten"
          ? "Reduced recovery run"
          : "Replace quality with base run",
      type: "recovery",
      ...(before.trail
        ? {
            trail: {
              expectedMinutes: Math.max(
                15,
                Math.round(
                  (before.trail.expectedMinutes * meters) /
                    (workoutKm(before, context.plan.easyPace) * 1000),
                ),
              ),
              ...(before.trail.ascentM !== undefined
                ? { ascentM: before.trail.ascentM }
                : {}),
            },
          }
        : {}),
      steps: [
        {
          kind: "step",
          name: "Run",
          amount: { kind: "distance", meters },
          target: before.trail
            ? { kind: "effort", min: 2, max: 3 }
            : {
                kind: "hr",
                min: context.athlete.targets.recoveryMin,
                max: context.athlete.targets.recoveryMax,
              },
        },
      ],
    };
    if (
      workoutKm(after, context.plan.easyPace) >
      workoutKm(before, context.plan.easyPace)
    )
      throw new Error("Workout volume cannot increase.");
  }
  return { before, after };
}

export function scheduleProposal(
  context: CoachData,
  kind: CoachKind,
  action: CoachAction,
): ScheduleChange[] {
  if (!allowedActions(context, kind).includes(action))
    throw new Error(
      "The recommendation conflicts with the local training rules.",
    );
  if (
    kind !== "today" ||
    action === "follow" ||
    !context.todaySchedule ||
    !context.plan
  )
    return [];
  if (action.startsWith("move_")) return context.moves[action] ?? [];
  // Recent pain may stop training even without today's check-in; additions need complete data.
  if (!context.canSchedule && action !== "rest") return [];
  const day = context.todaySchedule;
  const original = day.sessions.map((s) => s.session);
  let sessions: TrainingSession[] = original;
  if (action === "rest")
    sessions = day.sessions
      .filter((s) => s.status === "recorded")
      .map((s) => s.session);
  else if (action === "skip_secondary")
    sessions = day.sessions
      .filter((s) => s.session.sport === "running" || s.status === "recorded")
      .map((s) => s.session);
  else if (action === "cycle") {
    sessions = original.filter((s) => s.sport === "running");
    sessions.push({
      sport: "cycling",
      slot: "later",
      workout: cyclingWorkout(
        context.preferences,
        "recovery",
        context.preferences.weekdayCyclingMinutes,
      ),
    });
  } else {
    const proposal = workoutProposal(context, kind, action);
    if (!proposal) return [];
    sessions = day.sessions.flatMap<TrainingSession>((s) =>
      s.session.sport === "running"
        ? proposal.after
          ? [{ ...s.session, workout: proposal.after }]
          : []
        : s.status === "recorded"
          ? [s.session]
          : [],
    );
  }
  validateDaySessions(day.dayOffset, sessions, context.plan.easyPace, day.race);
  if (JSON.stringify(sessions) === JSON.stringify(original)) return [];
  return [{ day: day.day, sessions }];
}
