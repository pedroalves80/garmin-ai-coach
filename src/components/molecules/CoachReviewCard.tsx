import { useState } from "react";
import { Button } from "@/components/atoms/Button";
import { PlanSteps } from "./PlanSteps";
import { garminWorkoutText } from "@/shared/training-plan";
import type { CoachReview } from "@/shared/types/coach";

const labels = {
  follow: "Keep the schedule",
  shorten: "Reduce to 80% distance · HR 125–140 bpm",
  easy: "Replace with HR 125–140 bpm",
  rest: "Rest from running",
};
export function CoachReviewCard({
  review,
  accepted,
  pending,
  onAccept,
}: {
  review: CoachReview;
  accepted: boolean;
  pending: boolean;
  onAccept: () => void;
}) {
  const [copyMessage, setCopyMessage] = useState("");
  return (
    <article className="surface coach-review">
      <span className="eyebrow">
        {review.kind === "today" ? "Today's decision" : "Weekly review"} ·{" "}
        {review.day}
      </span>
      <h3>{labels[review.action]}</h3>
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
      {review.proposal && (
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
            <Button disabled={pending} onClick={onAccept}>
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
      )}
      <p className="muted small-text">
        {review.model} · {review.usage.inputTokens.toLocaleString()} input /{" "}
        {review.usage.outputTokens.toLocaleString()} output tokens ·{" "}
        {new Date(review.createdAt).toLocaleString("en-GB", {
          timeZone: "Europe/Lisbon",
        })}{" "}
        Lisbon
      </p>
    </article>
  );
}
