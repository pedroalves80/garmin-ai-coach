"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/atoms/Button";
import { CoachReviewCard } from "@/components/molecules/CoachReviewCard";
import type { CoachKind, CoachReview, CoachStatus } from "@/shared/types/coach";

export function CoachPanel() {
  const router = useRouter();
  const [status, setStatus] = useState<CoachStatus | null>(null);
  const [selected, setSelected] = useState<CoachReview | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/coach", { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        if (!r.ok)
          throw new Error("Coach status unavailable. Reload to retry.");
        const data: CoachStatus = await r.json();
        setStatus(data);
        setSelected(data.reviews[0] ?? null);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setMessage(error.message);
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, []);
  async function request(
    body:
      { action: "review"; kind: CoachKind } | { action: "accept"; id: string },
  ) {
    setPending(true);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-coach-request": "local",
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Coach request failed.");
      if (body.action === "review") {
        setSelected(data.review);
        setMessage(
          data.cached
            ? "Loaded the matching cached review. No new AI request."
            : "Review ready. Your workouts have not changed.",
        );
      } else {
        setMessage("Workout change approved and saved.");
        router.refresh();
      }
      const refreshed = await fetch("/api/coach", { cache: "no-store" });
      if (refreshed.ok) setStatus(await refreshed.json());
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : "Coach request failed.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="training-section"
      id="coach"
      aria-labelledby="coach-heading"
      aria-busy={pending}
    >
      <div className="section-heading">
        <h2 id="coach-heading">Your AI coach</h2>
        <span className="muted small-text">On demand</span>
      </div>
      <div className="surface">
        <p>
          Review your week or decide today’s run using your saved plan, Garmin
          training and recovery check-ins.
        </p>
        <p className="muted small-text">
          Requests send compact training and health summaries to OpenAI. GPS,
          activity names, check-in notes and keys stay on this server. Opening
          this page makes no AI request.
        </p>
        <div className="action-row coach-actions">
          <Button
            disabled={pending || !status?.configured}
            onClick={() => void request({ action: "review", kind: "today" })}
          >
            What should I do today?
          </Button>
          <Button
            className="button-secondary"
            disabled={pending || !status?.configured}
            onClick={() => void request({ action: "review", kind: "weekly" })}
          >
            Review my week
          </Button>
        </div>
        {status && (
          <p className="muted small-text">
            {status.dailyUsed}/{status.dailyLimit} requests today ·{" "}
            {status.monthlyUsed}/{status.monthlyLimit} this month ·{" "}
            {status.model}. Unchanged reviews use the cache. Limits reset in
            Europe/Lisbon.
          </p>
        )}
        {status && !status.configured && (
          <p className="muted">
            Set OPENAI_API_KEY in the server’s .env and restart to enable
            coaching.
          </p>
        )}
        <p
          role={failed ? "alert" : "status"}
          aria-live="polite"
          className={failed ? "error-text" : "muted"}
        >
          {pending ? "Preparing your coach review…" : message}
        </p>
        {!!status?.reviews.length && (
          <label className="coach-history">
            Saved reviews
            <select
              disabled={pending}
              value={selected?.id ?? ""}
              onChange={(e) =>
                setSelected(
                  status.reviews.find((r) => r.id === e.target.value) ?? null,
                )
              }
            >
              {selected &&
                !status.reviews.some((r) => r.id === selected.id) && (
                  <option value={selected.id}>
                    {selected.day} · {selected.kind}
                  </option>
                )}
              {status.reviews.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.day} · {r.kind} ·{" "}
                  {new Date(r.createdAt).toLocaleTimeString("en-GB", {
                    timeZone: "Europe/Lisbon",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {selected && (
        <CoachReviewCard
          key={selected.id}
          review={selected}
          accepted={status?.accepted?.reviewId === selected.id}
          pending={pending}
          onAccept={() => void request({ action: "accept", id: selected.id })}
        />
      )}
    </section>
  );
}
