"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/atoms/Button";
import { CoachReviewCard } from "@/components/molecules/CoachReviewCard";
import type { CoachKind, CoachReview, CoachStatus } from "@/shared/types/coach";
import { Icon } from "@/components/atoms/Icon";

export function CoachPanel() {
  const router = useRouter();
  const [status, setStatus] = useState<CoachStatus | null>(null);
  const [selected, setSelected] = useState<CoachReview | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/coach", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error("Coach status unavailable. Reload to retry.");
        const data: CoachStatus = await response.json();
        setStatus(data);
        setSelected((current) =>
          current
            ? (data.reviews.find((r) => r.id === current.id) ?? current)
            : (data.reviews[0] ?? null),
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Coach status unavailable.",
          );
          setFailed(true);
        }
      }
    }
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
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
      if (refreshed.ok) {
        const next: CoachStatus = await refreshed.json();
        setStatus(next);
        setSelected((current) =>
          current
            ? (next.reviews.find((r) => r.id === current.id) ?? current)
            : null,
        );
      }
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
      <div className="surface coach-intro">
        <span className="workout-symbol">
          <Icon name="coach" />
        </span>
        <h2 id="coach-heading">What would help today?</h2>
        <p className="muted">
          Review your whole week or decide today’s sessions using your saved
          plan, Garmin training and recovery check-ins.
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
        {status?.automatic && (
          <p className="muted small-text">
            {status.automatic.enabled
              ? status.automatic.attemptedAt
                ? "Today’s automatic review has been attempted. Request a fresh review if your data changed."
                : "Automatic review is waiting for a saved current week, fresh sync and today’s check-in. Sunday stays off."
              : "Automatic reviews are off in Settings."}
            {status.automatic.error && ` ${status.automatic.error}`}
          </p>
        )}
        <details className="supporting-details coach-privacy">
          <summary>Privacy & request limits</summary>
          <p className="muted small-text">
            Only compact training and health summaries go to OpenAI. GPS,
            activity names and check-in notes stay local. With automatic
            coaching enabled, one daily review runs after your check-in and
            fresh sync. Changes always need approval.
          </p>
          {status && (
            <p className="muted small-text">
              {status.dailyUsed}/{status.dailyLimit} requests today ·{" "}
              {status.monthlyUsed}/{status.monthlyLimit} this month ·{" "}
              {status.model}. Unchanged reviews use the cache. Limits reset in
              Europe/Lisbon.
            </p>
          )}
        </details>
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
          stale={
            !!status?.contextHash &&
            selected.contextHash !== status.contextHash &&
            selected.appliedContextHash !== status.contextHash
          }
          pending={pending}
          onAccept={() => void request({ action: "accept", id: selected.id })}
        />
      )}
    </section>
  );
}
