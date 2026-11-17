"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { planningPolicyReview } from "@/server/training/planning-policy";
import { Button } from "../atoms/Button";
type Review = ReturnType<typeof planningPolicyReview>;
export function LongTermPlanning({ initial }: { initial: Review }) {
  const router = useRouter(),
    [choice, setChoice] = useState<80 | 85 | 90>(initial.current.ceilingKm),
    [review, setReview] = useState(initial),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  async function analyze(value: 80 | 85 | 90) {
    setPending(true);
    setMessage("");
    try {
      const r = await fetch(`/api/training/planning-policy?ceiling=${value}`);
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setReview(data);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not review the ceiling.",
      );
    } finally {
      setPending(false);
    }
  }
  async function apply() {
    setPending(true);
    setMessage("");
    try {
      const r = await fetch("/api/training/planning-policy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-coach-request": "local",
        },
        body: JSON.stringify({ ceilingKm: choice, token: review.token }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setMessage(
        `Reviewed ${choice} km ceiling saved for new weeks from ${data.policy.effectiveFrom}.`,
      );
      router.refresh();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not apply the ceiling.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="surface screen-stack"
      aria-labelledby="long-term-heading"
    >
      <div>
        <span className="eyebrow">A CALENDAR THAT KEEPS GOING</span>
        <h2 id="long-term-heading">Long-term training</h2>
        <p className="muted small-text">
          The first 30 stages build towards 80 km. Then six consolidation weeks
          lead into repeating training and cutback blocks, with no end date.
          Weekly approval still checks actual running, recovery, races and
          breaks.
        </p>
      </div>
      <p>
        <strong>{initial.current.ceilingKm} km reviewed ceiling</strong> ·{" "}
        {initial.current.effectiveFrom
          ? `for new weeks from ${initial.current.effectiveFrom}`
          : "80 km is the initial planning limit"}
        . Higher mileage is optional, never automatic.
      </p>
      <details className="supporting-details">
        <summary>Review ceiling & upcoming blocks</summary>
        <div className="screen-stack">
          <label>
            Optional running ceiling
            <select
              value={choice}
              disabled={pending}
              onChange={(e) => {
                const value = Number(e.target.value) as 80 | 85 | 90;
                setChoice(value);
                void analyze(value);
              }}
            >
              <option value="80">
                80 km · sustain and develop performance
              </option>
              <option value="85">
                85 km · requires established training review
              </option>
              <option value="90">
                90 km · requires established training review
              </option>
            </select>
          </label>
          <p className="muted small-text">
            A higher ceiling requires a completed consolidation phase, sustained
            running near the existing ceiling, fresh Garmin data and supportive
            recovery. Ratings and daily check-ins stay optional. This review is
            calculated locally.
          </p>
          {review.reasons.map((r) => (
            <p className="small-text" key={r}>
              {r}
            </p>
          ))}
          <p className="muted small-text">{review.note}</p>
          <ol className="review-step-list">
            {review.preview.map((w) => (
              <li key={w.start}>
                <strong>
                  {w.start} · {w.km} km{w.cutback ? " · cutback" : ""}
                </strong>
                <p className="muted small-text">
                  {w.label} · conditional forecast
                </p>
              </li>
            ))}
          </ol>
          <Button
            disabled={
              pending ||
              !review.eligible ||
              review.proposed.ceilingKm !== choice ||
              choice === initial.current.ceilingKm
            }
            onClick={() => void apply()}
          >
            Apply reviewed ceiling
          </Button>
          <p className="muted small-text">
            Planning previews roll two years ahead from today. Saved history is
            retained as you keep using the app; only this week or next week can
            be activated.
          </p>
        </div>
      </details>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
