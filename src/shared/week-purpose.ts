import type { WeekSchedule } from "./types/schedule";
export function weekPurpose(calendar: WeekSchedule | null, cutback = false) {
  const phases = new Set(calendar?.days.map((d) => d.rule?.phase));
  if (phases.has("paused") || phases.has("return_review"))
    return "Training break / return review · recovery takes priority";
  if (phases.has("return"))
    return "Return to training · reviewed recovery baseline";
  if (phases.has("race"))
    return "Race week · event included in the distance budget";
  if (phases.has("race_recovery"))
    return "Race recovery · intensity reduced first; initial rest and recovery evidence can lower distance";
  if (phases.has("taper") || phases.has("race_week"))
    return "Race preparation · training events retain distance; goal events taper";
  return cutback
    ? "Planned cutback · room to recover"
    : "Build gradually. Review before progressing.";
}
