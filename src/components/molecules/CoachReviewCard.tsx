import { useState } from "react";
import { Button } from "@/components/atoms/Button";
import { PlanSteps } from "./PlanSteps";
import { garminWorkoutText } from "@/shared/training-plan";
import { SessionCard } from "./SessionCard";
import type { CoachAction, CoachReview } from "@/shared/types/coach";

const labels: Record<CoachAction, string> = {
  follow: "Keep the schedule",
  shorten: "Reduce distance · minimum 5 km · reviewed recovery HR",
  easy: "Replace quality with reviewed recovery HR",
  rest: "Rest from remaining training",
  cycle: "Keep the run · replace Hyrox with recovery cycling",
  skip_secondary: "Keep the run · skip the later session",
  move_0: "Move the run to Monday",
  move_1: "Move the run to Tuesday",
  move_2: "Move the run to Wednesday",
  move_3: "Move the run to Thursday",
  move_4: "Move the run to Friday",
  move_5: "Move the run to Saturday",
};
export function CoachReviewCard({
  review,
  accepted,
  pending,
  onAccept,
  stale = false,
}: {
  review: CoachReview;
  accepted: boolean;
  pending: boolean;
  onAccept: () => void;
  stale?: boolean;
}) {
  const [copyMessage, setCopyMessage] = useState("");
  return (
    <article className="surface coach-review">
      <span className="eyebrow">
        {review.kind === "today" ? "Today's decision" : "Weekly review"} ·{" "}
        {review.day}
      </span>
      <h3>
        {review.action === "cycle" &&
        !review.scheduleChanges?.some((c) =>
          c.sessions.some((s) => s.sport === "running"),
        )
          ? "Replace Hyrox with recovery cycling"
          : review.action === "skip_secondary" &&
              !review.scheduleChanges?.some((c) =>
                c.sessions.some((s) => s.sport === "running"),
              )
            ? "Skip the later session"
            : labels[review.action]}
      </h3>
      {stale && (
        <p className="inline-notice error-text">
          Training data changed after this review. Request a fresh review before
          using its recommendation. Your current calendar is in Plan.
        </p>
      )}
      <p>{review.summary}</p>
      <ul>
        {review.observations.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
      <p>{review.reason}</p>
      {review.constraints.map((text, i) => (
        <p className="muted small-text" key={i}>
          {text}
        </p>
      ))}
      {review.scheduleChanges?.length ? (
        <div className="coach-proposal">
          <h4>
            {accepted
              ? "Approved schedule"
              : "Proposed schedule · approval required"}
          </h4>
          {review.scheduleChanges.map((change) => (
            <section key={change.day} className="schedule-change">
              <strong>{change.day}</strong>
              {change.sessions.length ? (
                change.sessions.map((session, i) => (
                  <SessionCard key={i} entry={{ session, status: "planned" }} />
                ))
              ) : (
                <p>
                  Rest · no remaining workouts. Recorded activities stay in
                  history.
                </p>
              )}
            </section>
          ))}
          {!accepted && (
            <Button disabled={pending || stale} onClick={onAccept}>
              Approve schedule change
            </Button>
          )}
          {accepted && (
            <p className="success-text small-text">
              Saved to your weekly calendar. Copy the steps above to Garmin or
              Zwift.
            </p>
          )}
        </div>
      ) : (
        review.proposal && (
          <div className="coach-proposal">
            <h4>
              {accepted
                ? "Approved workout"
                : "Proposed change · approval required"}
            </h4>
            <p className="muted small-text">
              Replaces {review.proposal.before.title}. Applies to {review.day}{" "}
              only.
            </p>
            {review.proposal.after ? (
              <PlanSteps steps={review.proposal.after.steps} />
            ) : (
              <p>
                <strong>Rest · no run.</strong>
              </p>
            )}
            {!accepted && (
              <Button disabled={pending || stale} onClick={onAccept}>
                Approve this workout change
              </Button>
            )}
            {accepted && review.proposal.after && (
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      garminWorkoutText(review.proposal!.after!),
                    );
                    setCopyMessage("Garmin steps copied.");
                  } catch {
                    setCopyMessage(
                      "Clipboard unavailable. Copy the steps shown above manually.",
                    );
                  }
                }}
              >
                Copy approved Garmin steps
              </Button>
            )}
            {accepted && (
              <p className="muted small-text">
                Saved locally. Enter these steps in Garmin Connect.
              </p>
            )}
            {copyMessage && <p role="status">{copyMessage}</p>}
          </div>
        )
      )}
      <details className="supporting-details review-details">
        <summary>Review details</summary>
        <p className="muted small-text">
          {review.model} · {review.usage.inputTokens.toLocaleString()} input /{" "}
          {review.usage.outputTokens.toLocaleString()} output tokens ·{" "}
          {new Date(review.createdAt).toLocaleString("en-GB", {
            timeZone: "Europe/Lisbon",
          })}{" "}
          Lisbon
        </p>
      </details>
    </article>
  );
}
