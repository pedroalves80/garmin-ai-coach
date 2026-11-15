import type { WeekSchedule } from "./types/schedule";
export function weekPurpose(calendar: WeekSchedule | null, cutback = false) {
  if (
    calendar?.days.some(
      (d) =>
        d.race &&
        !d.sessions.some(
          (s) => s.session.sport === "running" && s.session.workout.race,
        ),
    )
  )
    return "Registered race withheld · resolve participation in Events";
  const phases = new Set(calendar?.days.map((d) => d.rule?.phase));
  if (phases.has("paused") || phases.has("return_review"))
    return "Training break / return review · recovery takes priority";
  if (phases.has("return"))
    return "Return to training · reviewed recovery baseline";
  if (phases.has("race"))
    return "Race week · event included in the distance budget";
  if (phases.has("race_recovery"))
    return calendar?.days.some((d) => d.rule?.provisional)
      ? "Race recovery · provisional; reassess after recorded training"
      : "Race recovery · targets reviewed from recorded training and recovery evidence";
  if (phases.has("taper") || phases.has("race_week"))
    return "Race preparation · training events retain distance; goal events taper";
  return cutback
    ? "Planned cutback · room to recover"
    : "Build gradually. Review before progressing.";
}
