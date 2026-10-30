"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TrainingDashboardData } from "@/server/training/dashboard";
import { Button } from "../atoms/Button";
export function SessionEffortLog({
  sessions,
}: {
  sessions: TrainingDashboardData["effortSessions"];
}) {
  const router = useRouter(),
    [id, setId] = useState(
      sessions.find((s) => s.rpe === null)?.id ?? sessions[0]?.id ?? "",
    ),
    [rpe, setRpe] = useState(""),
    [completed, setCompleted] = useState<boolean | null>(null),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  const selected = sessions.find((s) => s.id === id),
    value = rpe || String(selected?.rpe ?? "");
  return (
    <details className="surface supporting-details">
      <summary>
        Rate completed training ·{" "}
        {sessions.filter((s) => s.rpe === null).length} unrated
      </summary>
      <form
        className="screen-stack athlete-profile-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setMessage("");
          try {
            const response = await fetch("/api/training/athlete", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-coach-request": "local",
              },
              body: JSON.stringify({
                action: "effort",
                effort: {
                  activityId: id,
                  rpe: Number(value),
                  prescriptionCompleted:
                    selected?.sport === "running"
                      ? (completed ?? selected?.prescriptionCompleted ?? false)
                      : false,
                },
              }),
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(result.error ?? "Could not save effort.");
            setMessage(
              "Session effort saved. Weekly load and coach context updated.",
            );
            router.refresh();
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "Could not save effort.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <p className="muted small-text">
          Rate the whole session after you settle, ideally around 30 minutes
          later. 1 very light · 3 moderate · 5 hard · 7 very hard · 10 maximal.
          Use the same scale for running, Hyrox and cycling. Missing ratings
          remain unknown.
        </p>
        <label htmlFor="rated-session">
          Garmin session
          <select
            id="rated-session"
            required
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setRpe("");
              setCompleted(null);
            }}
          >
            <option value="">Choose a recorded session</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.day} · {s.sport} · {Math.round(s.minutes)} min
                {s.sport === "running" ? ` · ${s.km.toFixed(1)} km` : ""} ·{" "}
                {s.rpe === null ? "unrated" : `RPE ${s.rpe}`}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="session-rpe">
          Overall effort · RPE
          <select
            id="session-rpe"
            required
            value={value}
            onChange={(e) => setRpe(e.target.value)}
          >
            <option value="">Choose effort</option>
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        {selected?.sport === "running" && (
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={completed ?? selected.prescriptionCompleted}
              onChange={(e) => setCompleted(e.target.checked)}
            />{" "}
            I completed the prescribed running steps and intensity targets
          </label>
        )}
        <p className="muted small-text">
          Session load = recorded minutes × your RPE, in arbitrary units (AU).
          Weekly estimates use provisional effort assumptions; they are shown
          separately from your measured ratings and do not predict injury.
        </p>
        <div>
          <Button disabled={pending || !id || !value}>
            {pending ? "Saving…" : "Save session effort"}
          </Button>
        </div>
        {message && (
          <p role="status" className="small-text">
            {message}
          </p>
        )}
      </form>
    </details>
  );
}
