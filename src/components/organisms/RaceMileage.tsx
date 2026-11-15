"use client";
import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import type { TrainingDashboardData } from "@/server/training/dashboard";
import { Button } from "../atoms/Button";
export function RaceMileage({ data }: { data: TrainingDashboardData }) {
  const runs = data.effortSessions.filter((s) => s.sport === "running");
  const [activityId, setActivityId] = useState(runs[0]?.id ?? "");
  const selected = runs.find((r) => r.id === activityId);
  const [km, setKm] = useState<string | null>(null),
    [race, setRace] = useState<string | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter(),
    id = useId();
  const events = data.commitments.races.filter(
    (r) =>
      r.status !== "cancelled" &&
      selected &&
      Math.abs(
        Date.parse(r.day + "T12:00:00Z") -
          Date.parse(selected.day + "T12:00:00Z"),
      ) <= 86400000,
  );
  return (
    <details className="surface supporting-details">
      <summary>Race mileage · exclude warm-up/cool-down</summary>
      <form
        className="screen-stack athlete-profile-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setMessage("");
          try {
            const response = await fetch("/api/training/mileage", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-coach-request": "local",
              },
              body: JSON.stringify({
                activityId,
                raceId: (race ?? selected?.mileageRaceId ?? null) || null,
                excludedKm: Number(km ?? selected?.raceExtraKm ?? 0),
                confirmed,
              }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            setMessage(
              "Mileage updated; the full recording and physical load are retained.",
            );
            router.refresh();
          } catch (cause) {
            setMessage(
              cause instanceof Error
                ? cause.message
                : "Could not save mileage.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <p className="muted small-text">
          All dedicated running counts, including normal warm-ups, cool-downs
          and recoveries. Hyrox never counts. Only identify race
          warm-up/cool-down here: exclude the whole distance of a separate extra
          recording, or just the extra kilometres in a combined recording.
          Nothing is subtracted automatically. Set 0 to count the full recording
          again.
        </p>
        <label htmlFor={`${id}-run`}>
          Recorded run
          <select
            id={`${id}-run`}
            value={activityId}
            onChange={(e) => {
              setActivityId(e.target.value);
              setKm(null);
              setRace(null);
              setConfirmed(false);
              setMessage("");
            }}
          >
            <option value="">Choose a run</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.day} · {r.km.toFixed(2)} km recorded ·{" "}
                {r.countedKm.toFixed(2)} km counted
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-race`}>
          Associated race
          <select
            id={`${id}-race`}
            value={race ?? selected?.mileageRaceId ?? ""}
            onChange={(e) => setRace(e.target.value)}
          >
            <option value="">
              Choose the race (required when excluding distance)
            </option>
            {events.map((r) => (
              <option key={r.id} value={r.id}>
                {r.day} · {r.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-km`}>
          Race warm-up/cool-down kilometres to exclude
          <input
            id={`${id}-km`}
            type="number"
            min="0"
            max={selected?.km ?? 0}
            step="any"
            required
            value={km ?? String(selected?.raceExtraKm ?? 0)}
            onChange={(e) => setKm(e.target.value)}
          />
        </label>
        <Button
          type="button"
          className="button-secondary"
          disabled={!selected}
          onClick={() => setKm(String(selected?.km ?? 0))}
        >
          Use full recorded distance · separate race extra only
        </Button>
        <label className="checkbox-line">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />{" "}
          I confirm this exclusion is race warm-up/cool-down only, or 0 to
          restore counted mileage.
        </label>
        <Button disabled={pending || !selected || !confirmed}>
          {pending ? "Saving…" : "Save race mileage"}
        </Button>
        {message && <p role="status">{message}</p>}
      </form>
    </details>
  );
}
