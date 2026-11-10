"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RacePaceEvidence } from "@/shared/types/race-pacing";
import { finishTime } from "@/shared/race-pacing";
import { Button } from "../atoms/Button";
export function RacePacingEvidenceForm({
  today,
  evidence,
}: {
  today: string;
  evidence: RacePaceEvidence[];
}) {
  const last = evidence[0],
    router = useRouter();
  const [source, setSource] = useState<RacePaceEvidence["source"]>(
      last?.source ?? "garmin_prediction",
    ),
    [day, setDay] = useState(last?.day ?? today),
    [distance, setDistance] = useState(String(last?.distanceKm ?? 10)),
    [time, setTime] = useState(last ? finishTime(last.seconds) : ""),
    [confirmed, setConfirmed] = useState(false),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  return (
    <section className="surface">
      <span className="eyebrow">ROAD RACE PACING</span>
      <h2>Keep pace evidence up to date.</h2>
      <p className="muted small-text">
        Use a current Garmin prediction or a recent whole-course road race/time
        trial. Regular run averages and your entered event goals are not
        substituted for performance evidence. Trail races use effort guidance.
      </p>
      <details className="supporting-details">
        <summary>
          {last
            ? "Update prediction or add a confirmed result"
            : "Add prediction or confirmed result"}
        </summary>
        <form
          className="training-form pace-evidence-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            setMessage("");
            try {
              if (!/^\d{1,3}:[0-5]\d$/.test(time))
                throw new Error("Use total minutes:seconds, e.g. 50:00.");
              const [m, s] = time.split(":").map(Number);
              const r = await fetch("/api/training/race-pacing", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-coach-request": "local",
                },
                body: JSON.stringify({
                  source,
                  day,
                  distanceKm: Number(distance),
                  seconds: m * 60 + s,
                  confirmed,
                }),
              });
              const body = await r.json();
              if (!r.ok) throw new Error(body.error);
              setMessage(
                "Evidence saved. Race goals and workout steps were not changed.",
              );
              setConfirmed(false);
              router.refresh();
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Could not save evidence.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          <label>
            Evidence source
            <select
              value={source}
              onChange={(e) =>
                setSource(e.target.value as RacePaceEvidence["source"])
              }
            >
              <option value="garmin_prediction">
                Garmin prediction · estimate
              </option>
              <option value="road_race">
                Confirmed road race · actual result
              </option>
              <option value="road_test">
                Confirmed road time trial · actual result
              </option>
            </select>
          </label>
          <label>
            Date of evidence
            <input
              type="date"
              required
              max={today}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <label>
            Reference distance · km
            <input
              type="number"
              min="3"
              max="21.1"
              step="0.01"
              required
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
          </label>
          <label>
            Whole-course time · total min:sec
            <input
              required
              inputMode="text"
              placeholder="50:00"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <label className="checkbox-line">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {source === "garmin_prediction"
              ? "This is a current prediction displayed by Garmin, not my goal time."
              : "This is a completed continuous road race/test at full effort, excluding warm-up and cool-down."}
          </label>
          <Button disabled={pending}>
            {pending ? "Saving…" : "Save pace evidence"}
          </Button>
        </form>
      </details>
      {last && (
        <p className="muted small-text">
          Latest evidence: {last.day} · {last.distanceKm} km ·{" "}
          {finishTime(last.seconds)} · {last.source.replaceAll("_", " ")}
        </p>
      )}
      {message && (
        <p className="inline-notice small-text" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
