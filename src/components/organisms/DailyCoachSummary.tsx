"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { CoachStatus } from "@/shared/types/coach";
export function DailyCoachSummary({ today }: { today: string }) {
  const [status, setStatus] = useState<CoachStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function update() {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch("/api/coach", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (r.ok) setStatus(await r.json());
      } catch {
        /* Next poll retries without generating AI requests. */
      }
    }
    void update();
    const timer = setInterval(() => void update(), 30000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, []);
  const review = status?.reviews.find(
    (r) => r.kind === "today" && r.day === today,
  );
  const stale =
    !!review &&
    !!status?.contextHash &&
    review.contextHash !== status.contextHash &&
    review.appliedContextHash !== status.contextHash;
  return (
    <section className="surface daily-coach-summary">
      <span className="eyebrow">YOUR DAILY COACH</span>
      <h2>
        {stale
          ? "Your review needs refreshing"
          : review
            ? "Today's recommendation"
            : "Based on your training"}
      </h2>
      <p className="muted">
        {stale
          ? "New training or recovery data arrived after the saved review. Request a fresh recommendation in Coach."
          : (review?.summary ??
            (status?.automatic?.enabled
              ? "Accept the prepared week once. Garmin sync supports background coaching; recovery updates are optional. Sunday remains rest."
              : "Your training and Garmin recovery data inform reviews. Request a review in Coach when needed; daily check-ins are optional."))}
      </p>
      {review && (
        <p className="muted small-text">
          {status?.accepted?.reviewId === review.id
            ? "This change is approved in your calendar."
            : "Review the full recommendation in Coach. Your schedule changes only after approval."}{" "}
          Review uses data available at{" "}
          {new Date(review.createdAt).toLocaleTimeString("en-GB", {
            timeZone: "Europe/Lisbon",
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      )}
      {status?.automatic?.error && (
        <p className="small-text error-text">{status.automatic.error}</p>
      )}
      <Link className="text-link" href="/coach">
        {review ? "Review recommendation →" : "Open Coach →"}
      </Link>
    </section>
  );
}
