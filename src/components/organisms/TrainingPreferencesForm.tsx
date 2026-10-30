"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TrainingPreferences } from "@/shared/types/schedule";
import { Button } from "../atoms/Button";
import { powerRange } from "@/shared/weekly-schedule";

export function TrainingPreferencesForm({
  initial,
}: {
  initial: TrainingPreferences;
}) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  const recovery = powerRange(prefs.ftpWatts, 45, 55),
    endurance = powerRange(prefs.ftpWatts, 56, 70);
  return (
    <form
      className="surface screen-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setMessage("");
        try {
          const response = await fetch("/api/training/schedule", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-coach-request": "local",
            },
            body: JSON.stringify({ action: "preferences", preferences: prefs }),
          });
          const result = await response.json();
          if (!response.ok)
            throw new Error(result.error ?? "Could not save preferences.");
          setMessage("Training preferences saved.");
          router.refresh();
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not save preferences.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <div>
        <span className="eyebrow">RUNNING COMES FIRST</span>
        <h2>Training preferences</h2>
      </div>
      <div className="training-form editor-fields">
        <label htmlFor="ftp-watts">
          Current cycling FTP · W
          <input
            id="ftp-watts"
            type="number"
            required
            min="40"
            max="700"
            value={prefs.ftpWatts}
            onChange={(e) =>
              setPrefs({ ...prefs, ftpWatts: Number(e.target.value) })
            }
          />
        </label>
        <label htmlFor="weekday-cycle">
          Weekday cycling · min
          <input
            id="weekday-cycle"
            type="number"
            required
            min="15"
            max="1440"
            value={prefs.weekdayCyclingMinutes}
            onChange={(e) =>
              setPrefs({
                ...prefs,
                weekdayCyclingMinutes: Number(e.target.value),
              })
            }
          />
        </label>
        <label htmlFor="saturday-cycle">
          Saturday cycling · min
          <input
            id="saturday-cycle"
            type="number"
            required
            min="15"
            max="1440"
            value={prefs.saturdayCyclingMinutes}
            onChange={(e) =>
              setPrefs({
                ...prefs,
                saturdayCyclingMinutes: Number(e.target.value),
              })
            }
          />
        </label>
      </div>
      <p className="muted small-text">
        Recovery: {recovery.min}–{recovery.max} W. Endurance: {endurance.min}–
        {endurance.max} W. These are conservative supporting rides. Duration
        settings are workout defaults, not your availability limits.
      </p>
      <label className="checkbox-line">
        <input
          type="checkbox"
          checked={prefs.automaticCoach}
          onChange={(e) =>
            setPrefs({ ...prefs, automaticCoach: e.target.checked })
          }
        />{" "}
        Prepare a daily AI recommendation automatically
      </label>
      <p className="muted small-text">
        After a saved current week, fresh Garmin sync and today’s check-in, the
        background worker prepares at most one review per day. Compact training
        and health summaries go to OpenAI. Approval is required for changes.
        Sunday stays off. Uses the same 6/day and 60/month limits as manual
        reviews.
      </p>
      <p className="muted small-text">
        Up to two workouts daily. Weekday lunch: up to 2 hours. Later sessions
        and Saturday: no availability cap. Sunday: rest.
      </p>
      <div>
        <Button disabled={pending} type="submit">
          {pending ? "Saving…" : "Save training preferences"}
        </Button>
      </div>
      {message && (
        <p role="status" className="small-text">
          {message}
        </p>
      )}
    </form>
  );
}
