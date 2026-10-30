import type { CoachAction, CoachKind } from "../../shared/types/coach";
import type { RunWorkout } from "../../shared/types/metrics";
import { workoutKm, minimumRunKm } from "../../shared/training-plan";
import type { CoachData } from "./context";
import { allowedActions } from "./context";

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
      title:
        action === "shorten"
          ? "Reduced recovery run"
          : "Replace quality with base run",
      type: "recovery",
      steps: [
        {
          kind: "step",
          name: "Run",
          amount: { kind: "distance", meters },
          target: { kind: "hr", min: 125, max: 140 },
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
