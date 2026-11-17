"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WeeklyPlanning } from "@/shared/types/weekly-planning";
import type { TrainingPlan } from "@/shared/types/metrics";
import { Button } from "../atoms/Button";
import { StatusBadge } from "../atoms/StatusBadge";

export function WeeklyPlanReview({
  planning,
  compact = false,
  matches = true,
  onUse,
  onAccepted,
}: {
  planning: WeeklyPlanning;
  compact?: boolean;
  matches?: boolean;
  onUse?: () => void;
  onAccepted?: (plan: TrainingPlan) => void;
}) {
  const router = useRouter(),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const plan = planning.selected.plan,
    reference = planning.reference;
  async function accept() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/training/week", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-coach-request": "local",
        },
        body: JSON.stringify({ token: planning.token, start: planning.start }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not accept the week.");
      onAccepted?.(result.plan);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not accept the week.",
      );
    } finally {
      setPending(false);
    }
  }
  if (!planning.needsApproval) return null;
  return (
    <section
      className="surface weekly-coach-card"
      aria-labelledby={
        compact ? "weekly-ready-heading" : "weekly-review-heading"
      }
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR WEEKLY COACH · {planning.start}</span>
          <h2 id={compact ? "weekly-ready-heading" : "weekly-review-heading"}>
            {reference
              ? `${reference.stage <= 30 ? "Stage" : "Week"} ${reference.stage} reviewed → ${plan.weekNumber <= 30 ? "Stage" : "Week"} ${plan.weekNumber}`
              : "Your starting week is ready"}
          </h2>
        </div>
        <StatusBadge tone="info">
          {planning.source === "ai" ? "AI reviewed" : "Garmin analysis"}
        </StatusBadge>
      </div>
      {reference && (
        <p className="weekly-evidence">
          <strong>
            {reference.recordedKm.toFixed(2)} / {reference.plannedKm.toFixed(1)}{" "}
            km
          </strong>{" "}
          recorded · {reference.runs} runs · week of {reference.start}
        </p>
      )}
      {planning.correction && (
        <p className="inline-notice">
          Saved Stage {planning.correction.savedStage} needs correction to Stage{" "}
          {planning.correction.expectedStage}. Review and accept this proposal;
          saved steps and adjustments are retained until then.
        </p>
      )}
      <p>{planning.summary}</p>
      <p className="muted small-text">
        {plan.targetKm.toFixed(1)} km ·{" "}
        {
          planning.selected.calendar.days.filter((d) =>
            d.sessions.some((s) => s.session.sport === "running"),
          ).length
        }{" "}
        running days · supporting sessions planned around running. Nothing
        becomes active until you accept.
      </p>
      {planning.blockedReason && (
        <p className="inline-notice">{planning.blockedReason}</p>
      )}
      {compact ? (
        <Link className="button" href={`/plan?date=${planning.start}`}>
          Review prepared week →
        </Link>
      ) : (
        <>
          <div className="action-row">
            <Button
              type="button"
              disabled={pending || !!planning.blockedReason}
              onClick={() => (matches ? void accept() : onUse?.())}
            >
              {pending
                ? "Accepting…"
                : matches
                  ? planning.correction
                    ? "Accept corrected week"
                    : "Accept this week"
                  : "Use prepared week"}
            </Button>
            <Button
              type="button"
              className="button-secondary"
              disabled={pending}
              onClick={() => router.refresh()}
            >
              Recheck training data
            </Button>
          </div>
          {!matches && (
            <p className="muted small-text">
              The editor has different settings. Use the prepared week to see
              its exact steps before accepting.
            </p>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {planning.aiStatus === "corrected" && (
            <p className="inline-notice">
              Updated proposal: the earlier AI choice had no verified reason to
              reduce this recommendation. Routine Hyrox and cycling do not block
              progression by themselves.
            </p>
          )}
          <p className="muted small-text">
            One weekly approval. Daily recovery check-ins and effort ratings are
            optional.
          </p>
          <details className="supporting-details">
            <summary>Why this week · evidence & changes</summary>
            <p className="muted small-text">
              Supporting training:{" "}
              {planning.selectionPolicy.supportingWorkload.recentMinutes.toFixed(
                1,
              )}{" "}
              min last week
              {planning.selectionPolicy.supportingWorkload.baselineMinutes !==
              null
                ? ` versus ${planning.selectionPolicy.supportingWorkload.baselineMinutes.toFixed(1)} min/week across ${planning.selectionPolicy.supportingWorkload.baselineWeeks} prior recorded weeks.`
                : ". No recorded supporting-workload baseline is available yet."}{" "}
              Routine supporting work alone does not prevent running
              progression.
            </p>
            {planning.selectionPolicy.reductionEvidence.map((e) => (
              <p key={e.code} className="muted small-text">
                {e.detail}
              </p>
            ))}
            {planning.observations.map((text, i) => (
              <p key={`observation-${i}`}>{text}</p>
            ))}
            {planning.reasons.map((text, i) => (
              <p className="muted small-text" key={`reason-${i}`}>
                {text}
              </p>
            ))}
            <p className="muted small-text">
              {planning.aiStatus === "ready"
                ? "AI selects among checked plans; it cannot invent faster targets or extra volume."
                : planning.aiStatus === "corrected"
                  ? "The earlier AI selection was corrected locally. No extra AI request was made."
                  : planning.aiStatus === "pending"
                    ? "The data-based draft is ready now. A background AI review may add its recommendation; it never blocks approval."
                    : planning.aiStatus === "refreshed"
                      ? "New evidence arrived after the AI review. This draft uses the updated data without another paid request."
                      : "The data-based draft remains available without an AI response."}
            </p>
            <p className="muted small-text">
              Sleep and resting HR inform recovery flags; they do not establish
              absence of injury. {planning.performance.pairs} comparable pace/HR
              pairs. Running targets stay at their saved values until there is
              evidence to review them.
            </p>
            <div
              className="weekly-history"
              role="region"
              aria-label="Completed training weeks"
              tabIndex={0}
            >
              <table>
                <caption>Recent completed training</caption>
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Running</th>
                    <th>Runs</th>
                    <th>Cycling</th>
                    <th>Hyrox</th>
                  </tr>
                </thead>
                <tbody>
                  {[...planning.history.weeks].reverse().map((w) => (
                    <tr key={w.start}>
                      <th scope="row">{w.start}</th>
                      <td>{w.runningKm.toFixed(1)} km</td>
                      <td>{w.runs}</td>
                      <td>{Math.round(w.cyclingMinutes)} min</td>
                      <td>{Math.round(w.hyroxMinutes)} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
