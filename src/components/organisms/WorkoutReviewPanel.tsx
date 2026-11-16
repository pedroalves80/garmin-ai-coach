"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkoutReview } from "@/shared/types/workout-review";
import { formatPace } from "@/shared/training-plan";
import { Button } from "../atoms/Button";
import { StatusBadge } from "../atoms/StatusBadge";
export function WorkoutReviewPanel({
  data,
}: {
  data: { revision: string; reviews: WorkoutReview[] };
}) {
  const router = useRouter(),
    [selected, setSelected] = useState(data.reviews[0]?.activityId ?? "");
  const review =
    data.reviews.find((r) => r.activityId === selected) ?? data.reviews[0];
  return (
    <section className="surface" aria-labelledby="workout-review-heading">
      <span className="eyebrow">LEARN FROM YOUR RUNNING</span>
      <h2 id="workout-review-heading">Planned & completed</h2>
      <p className="muted small-text">
        Updated locally after Garmin sync. Step details stay unknown when Garmin
        supplies only grouped summaries. Feedback is optional.
      </p>
      {data.reviews.length ? (
        <>
          <label htmlFor="review-activity">
            Recorded run
            <select
              id="review-activity"
              value={review?.activityId ?? ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              {data.reviews.map((r) => (
                <option key={r.activityId} value={r.activityId}>
                  {r.day} · {r.km.toFixed(2)} km · {r.name}
                </option>
              ))}
            </select>
          </label>
          {review && (
            <ReviewCard
              key={`${review.activityId}:${data.revision}`}
              review={review}
              revision={data.revision}
              onSaved={() => router.refresh()}
            />
          )}
        </>
      ) : (
        <p>
          No dedicated running recordings in the last 90 days. Sync Garmin after
          your next run.
        </p>
      )}
    </section>
  );
}
function ReviewCard({
  review: r,
  revision,
  onSaved,
}: {
  review: WorkoutReview;
  revision: string;
  onSaved: () => void;
}) {
  const [choice, setChoice] = useState(
      r.match === "manual"
        ? (r.snapshot?.id ?? "unplanned")
        : r.manualChoice
          ? "unplanned"
          : "automatic",
    ),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(false);
  async function save(body: object) {
    setPending(true);
    setMessage("");
    setError(false);
    try {
      const response = await fetch("/api/training/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-coach-request": "local",
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "Could not save.");
      setMessage("Review saved. Your next coach review uses this evidence.");
      onSaved();
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setPending(false);
    }
  }
  const matched = r.match === "manual" || r.match === "automatic";
  return (
    <article className="screen-stack workout-review-card">
      <div className="section-heading">
        <div>
          <h3>{r.name}</h3>
          <p className="muted small-text">
            {r.day} · {r.minutes.toFixed(0)} min ·{" "}
            {r.averageHr === null
              ? "HR unavailable"
              : `${r.averageHr} bpm activity average`}
          </p>
        </div>
        <StatusBadge tone={matched ? "success" : "warning"}>
          {r.match === "automatic"
            ? "Matched automatically"
            : r.match === "manual"
              ? "Matched by you"
              : r.match === "suggested"
                ? "Confirm match"
                : r.match === "ambiguous"
                  ? "Match unclear"
                  : "Unplanned"}
        </StatusBadge>
      </div>
      <div className="review-totals">
        <p>
          <strong>
            {r.plannedKm === null ? "—" : r.plannedKm.toFixed(2)} km
          </strong>
          <span>{matched ? "Planned" : "Possible plan"}</span>
        </p>
        <p>
          <strong>{r.countedKm.toFixed(2)} km</strong>
          <span>Counted running</span>
        </p>
        <p>
          <strong>{r.km.toFixed(2)} km</strong>
          <span>Total recorded</span>
        </p>
      </div>
      {matched && (
        <p className="small-text">
          <strong>
            {r.distanceStatus === "met"
              ? "Distance within 90–110% of plan"
              : r.distanceStatus === "partial"
                ? "Recorded distance below 90% of plan"
                : r.distanceStatus === "over"
                  ? "Recorded distance above 110% of plan"
                  : "Distance unknown"}
            .
          </strong>{" "}
          This is a distance comparison, not a pass/fail grade for the whole
          workout.
        </p>
      )}
      {r.snapshot && (
        <p className="small-text">
          Prescription: <strong>{r.snapshot.workout?.title}</strong> · scheduled{" "}
          {r.snapshot.day}.{" "}
          {r.versionKnown
            ? `Version captured ${r.snapshot.capturedAt.slice(0, 16).replace("T", " ")} UTC, before this activity.`
            : "Historical approved version is unverified; this plan was reconstructed or captured later."}
        </p>
      )}
      <details
        className="supporting-details"
        open={!matched && !!r.choices.length}
      >
        <summary>Confirm or correct the match</summary>
        <form
          className="screen-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              choice === "automatic"
                ? { action: "automatic", activityId: r.activityId, revision }
                : {
                    action: "link",
                    activityId: r.activityId,
                    snapshotId: choice === "unplanned" ? null : choice,
                    revision,
                  },
            );
          }}
        >
          <label>
            Workout prescription
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="automatic">Use automatic matching</option>
              <option value="unplanned">Leave this run unplanned</option>
              {r.choices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.day} · {s.workout?.title} · captured{" "}
                  {s.capturedAt.slice(0, 16).replace("T", " ")} UTC
                  {s.source === "legacy" ? " · legacy baseline" : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small-text">
            A manual match associates this recording with the selected version.
            It does not move a run, edit your plan or prove an old prescription
            was current. One prescription can be linked to one activity.
          </p>
          <Button className="button-secondary" disabled={pending}>
            Save match
          </Button>
        </form>
      </details>
      {matched && (
        <details className="supporting-details">
          <summary>Recorded steps & evidence</summary>
          <p className="small-text">
            {r.detailStatus === "pending"
              ? "Detailed Garmin data has not been fetched yet. The next sync checks recent runs."
              : r.detailStatus === "unavailable"
                ? "Garmin detail is currently unavailable; distance and duration remain usable."
                : r.detailStatus === "stale"
                  ? "The activity changed; detail will be refreshed on sync."
                  : r.detailStatus === "loading"
                    ? "Garmin detail is being refreshed."
                    : "Garmin detail checked."}{" "}
            {r.attachedWorkout
              ? "A structured workout was attached; this does not prove its execution."
              : "No attached structured workout is confirmed."}
          </p>
          <ol className="review-step-list">
            {r.steps.map((s, i) => (
              <li key={i}>
                <strong>
                  {s.name} · {(s.plannedMeters / 1000).toFixed(2)} km planned
                </strong>
                <p className="small-text">
                  {s.recordedMeters === null
                    ? "Recorded step unknown"
                    : `${(s.recordedMeters / 1000).toFixed(2)} km recorded`}
                  {s.averageHr !== null
                    ? ` · ${s.averageHr} bpm split average`
                    : ""}
                  {s.averagePace !== null
                    ? ` · ${formatPace(s.averagePace)}/km split average`
                    : ""}
                  .{" "}
                  {s.state === "average_inside"
                    ? "Split average within target; time in target unknown."
                    : s.state === "average_outside"
                      ? "Split average outside target; this alone is not a failed workout."
                      : s.state === "distance_differs"
                        ? "Split distance differs; target compliance uncertain."
                        : s.state === "effort_only"
                          ? "Effort needs athlete context."
                          : "Target execution unknown."}
                </p>
                <p className="muted small-text">{s.note}</p>
              </li>
            ))}
          </ol>
        </details>
      )}
      <div>
        <strong>
          How did it feel compared with the plan?{" "}
          <span className="muted small-text">Optional</span>
        </strong>
        <div className="action-row review-feedback">
          {(
            [
              ["easier", "Easier"],
              ["right", "About right"],
              ["harder", "Harder"],
            ] as const
          ).map(([value, label]) => (
            <Button
              type="button"
              className="button-secondary"
              key={value}
              aria-pressed={r.feeling === value}
              disabled={pending}
              onClick={() =>
                void save({
                  action: "feedback",
                  activityId: r.activityId,
                  feeling: value,
                })
              }
            >
              {label}
            </Button>
          ))}
          {r.feeling && (
            <Button
              type="button"
              className="button-secondary"
              disabled={pending}
              onClick={() =>
                void save({
                  action: "feedback",
                  activityId: r.activityId,
                  feeling: null,
                })
              }
            >
              Clear
            </Button>
          )}
        </div>
        <p className="muted small-text">
          This is relative feedback, not an invented RPE score or symptom
          report. It never changes an approved workout automatically.
        </p>
      </div>
      {r.notes.map((n) => (
        <p className="muted small-text" key={n}>
          {n}
        </p>
      ))}
      {message && (
        <p
          className={error ? "error-text" : "success-text"}
          role={error ? "alert" : "status"}
        >
          {message}
        </p>
      )}
    </article>
  );
}
