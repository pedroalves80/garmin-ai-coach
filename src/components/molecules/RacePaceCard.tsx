import Link from "next/link";
import { formatPace } from "@/shared/training-plan";
import { finishTime } from "@/shared/race-pacing";
import type { RacePaceAdvice } from "@/shared/types/race-pacing";
export function RacePaceCard({ advice }: { advice: RacePaceAdvice }) {
  return (
    <section
      className="race-pace-card"
      aria-label={`Race pacing for ${advice.day}`}
    >
      <strong>
        {advice.terrain === "trail"
          ? "Trail effort guidance"
          : "Road pacing guide"}
      </strong>
      {advice.reference && advice.predictedPace !== null && (
        <p className="small-text">
          {advice.reference.source === "garmin_prediction"
            ? "User-reported Garmin estimate"
            : "Road performance estimate"}
          : <strong>{formatPace(Math.round(advice.predictedPace))}/km</strong> ·{" "}
          {finishTime(advice.predictedSeconds!)} · {advice.confidence}{" "}
          confidence · evidence from {advice.reference.day}
        </p>
      )}
      {advice.range && (
        <p className="inline-notice small-text">
          Provisional planning range:{" "}
          <strong>
            {formatPace(advice.range.min)}–{formatPace(advice.range.max)}/km
          </strong>
          . This is a cautious starting estimate, not a confirmed race target or
          proof of readiness.
        </p>
      )}
      {!advice.range && <p className="small-text">{advice.notes[0]}</p>}
      <details className="supporting-details">
        <summary>Evidence, progress & uncertainty</summary>
        {advice.notes.map((note, i) => (
          <p className="muted small-text" key={i}>
            {note}
          </p>
        ))}
        <p className="muted small-text">
          Entered race duration is your planning input, not measured fitness.
          Saving evidence never changes race goals, Garmin steps or training
          targets.
        </p>
        <Link href="/coach" className="text-link">
          Review this evidence with the AI coach →
        </Link>
      </details>
    </section>
  );
}
