import type { RunWorkout } from "@/shared/types/metrics";
import { TRAIL_GUIDANCE, trailSummary } from "@/shared/trail-running";
export function TrailGuidance({ workout }: { workout: RunWorkout }) {
  if (!workout.trail) return null;
  return (
    <aside className="inline-notice small-text">
      <strong>{trailSummary(workout)}</strong>
      <p>
        RPE {workout.type === "recovery" ? "2–3" : "3–4"}/10 · full-sentence
        conversation. Hike steep climbs; descend under control. HR is feedback,
        rather than a narrow alert.
      </p>
      <details>
        <summary>Trail effort &amp; Garmin instructions</summary>
        <p>{TRAIL_GUIDANCE}</p>
        <p>
          Garmin: choose “No Target” and copy each numeric RPE instruction into
          the step notes. Hiking counts towards the distance. Record as Trail
          Run in Garmin to keep trail pace out of road pace/HR comparisons.
        </p>
      </details>
    </aside>
  );
}
