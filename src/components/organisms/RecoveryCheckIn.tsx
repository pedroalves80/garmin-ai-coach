"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/atoms/Button";
import { StatusBadge } from "@/components/atoms/StatusBadge";
import type { TrainingDashboardData } from "@/server/training/dashboard";

export function RecoveryCheckIn({ data }: { data: TrainingDashboardData }) {
  const router = useRouter();
  const [day, setDay] = useState(data.today),
    [fatigue, setFatigue] = useState(String(data.todayCheckIn?.fatigue ?? "")),
    [soreness, setSoreness] = useState(
      String(data.todayCheckIn?.soreness ?? ""),
    ),
    [pain, setPain] = useState(String(data.todayCheckIn?.pain ?? "")),
    [notes, setNotes] = useState(data.todayCheckIn?.notes ?? "");
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  const earliest = new Date(`${data.today}T12:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 14);
  return (
    <details className="surface check-in-card">
      <summary>
        <span>
          <span className="detail-title">How are you feeling?</span>
          <span className="muted small-text detail-subtitle">
            Your daily recovery check-in
          </span>
        </span>
        <StatusBadge tone={data.todayCheckIn ? "success" : "info"}>
          {data.todayCheckIn ? "Logged" : "Not logged"}
        </StatusBadge>
      </summary>
      <form
        className="training-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setFailed(false);
          setMessage("");
          try {
            const response = await fetch("/api/training/check-in", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-coach-request": "local",
              },
              body: JSON.stringify({
                day,
                fatigue: Number(fatigue),
                soreness: Number(soreness),
                pain: Number(pain),
                notes,
              }),
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(result.error ?? "Could not save your check-in.");
            setMessage("Check-in saved.");
            router.refresh();
          } catch (error) {
            setFailed(true);
            setMessage(
              error instanceof Error
                ? error.message
                : "Could not save your check-in.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <p className="muted small-text">
          Fatigue and soreness: 1 low → 5 high. Pain: 0 none → 10 severe.
        </p>
        <div className="check-in-scores">
          {[
            {
              id: "fatigue",
              label: "Fatigue",
              value: fatigue,
              set: setFatigue,
              min: 1,
              max: 5,
            },
            {
              id: "soreness",
              label: "Soreness",
              value: soreness,
              set: setSoreness,
              min: 1,
              max: 5,
            },
            {
              id: "pain",
              label: "Pain",
              value: pain,
              set: setPain,
              min: 0,
              max: 10,
            },
          ].map((field) => (
            <label key={field.id} htmlFor={field.id}>
              {field.label}
              <select
                id={field.id}
                value={field.value}
                required
                onChange={(e) => field.set(e.target.value)}
              >
                <option value="">Select</option>
                {Array.from(
                  { length: field.max - field.min + 1 },
                  (_, i) => i + field.min,
                ).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <label htmlFor="check-day">
          Date
          <input
            id="check-day"
            type="date"
            value={day}
            min={earliest.toISOString().slice(0, 10)}
            max={data.today}
            required
            onChange={(e) => {
              const next = e.target.value,
                c = data.checkIns.find((c) => c.day === next);
              setDay(next);
              setFatigue(String(c?.fatigue ?? ""));
              setSoreness(String(c?.soreness ?? ""));
              setPain(String(c?.pain ?? ""));
              setNotes(c?.notes ?? "");
            }}
          />
        </label>
        <label htmlFor="check-notes">
          Notes <span className="muted">· optional, kept locally</span>
          <textarea
            id="check-notes"
            maxLength={300}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <Button disabled={pending} type="submit">
          {pending ? "Saving…" : "Save check-in"}
        </Button>
        {message && (
          <p
            className={failed ? "error-text" : "success-text"}
            role={failed ? "alert" : "status"}
          >
            {message}
          </p>
        )}
      </form>
    </details>
  );
}
