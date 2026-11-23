import type { RaceEvent } from "@/shared/types/commitments";

export function AutomaticRecoveryNotice({ race }: { race: RaceEvent }) {
  const assessment = race.automaticRecovery;
  if (!assessment) return null;
  return (
    <div
      className="inline-notice small-text"
      aria-label={`Automatic recovery review for ${race.name}`}
    >
      <strong>
        {assessment.status === "base"
          ? "Base effort supported automatically"
          : "Automatic recovery review · collecting evidence"}
      </strong>
      <p>{assessment.reasons[0]}</p>
      <details>
        <summary>Recovery evidence & next steps</summary>
        <p>
          Checked {assessment.checkedOn} ·{" "}
          {Math.min(2, assessment.recoveryRuns)}/2 qualifying recovery-run days
          · Garmin overnight data: {assessment.healthDay ?? "unavailable"}.
        </p>
        {assessment.reasons.slice(1).map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        <p>
          Reassessed automatically from Garmin after sync and as the date
          changes. Daily check-ins are optional. Only upcoming, unmodified
          running targets can return to your existing base range; distance,
          tempo, strides and Hyrox restrictions do not increase. Garmin averages
          cannot confirm absence of pain or full muscular recovery. Report pain
          or unusual fatigue whenever needed. Copy updated steps to Garmin
          Connect if a workout is already scheduled there.
        </p>
      </details>
    </div>
  );
}
