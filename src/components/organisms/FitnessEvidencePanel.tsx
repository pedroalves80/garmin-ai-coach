"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FitnessEvidence } from "@/shared/types/workout-review";
import { formatPace } from "@/shared/training-plan";
import { Button } from "../atoms/Button";
function parsePace(value: string) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
export function FitnessEvidencePanel({
  evidence,
  today,
}: {
  evidence: FitnessEvidence[];
  today: string;
}) {
  const router = useRouter(),
    [kind, setKind] = useState<FitnessEvidence["kind"]>("threshold"),
    [editing, setEditing] = useState<string | null>(null),
    [open, setOpen] = useState(false),
    [date, setDate] = useState(""),
    [hr, setHr] = useState(""),
    [pace, setPace] = useState(""),
    [power, setPower] = useState(""),
    [relative, setRelative] = useState(""),
    [source, setSource] =
      useState<FitnessEvidence["source"]>("garmin_estimate"),
    [device, setDevice] = useState(""),
    [sensor, setSensor] = useState(""),
    [talk, setTalk] = useState(true),
    [breathing, setBreathing] = useState(true),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(false);
  const active = evidence.filter((e) => !e.archivedAt),
    archived = evidence.filter((e) => e.archivedAt);
  async function save(body: object) {
    setPending(true);
    setMessage("");
    setError(false);
    try {
      const r = await fetch("/api/training/fitness-evidence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-coach-request": "local",
        },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error ?? "Could not save.");
      setMessage(
        "Evidence saved. Running targets and cycling FTP stay as reviewed.",
      );
      setEditing(null);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setPending(false);
    }
  }
  function edit(e: FitnessEvidence) {
    setEditing(e.id);
    setKind(e.kind);
    setDate(e.observedOn ?? "");
    setHr(String(e.heartRate));
    setPace(e.paceSeconds ? formatPace(e.paceSeconds) : "");
    setPower(e.powerWatts ? String(e.powerWatts) : "");
    setRelative(e.wattsPerKg ? String(e.wattsPerKg) : "");
    setSource(e.source);
    setDevice(e.device);
    setSensor(e.sensor);
    setTalk(e.comfortableTalk ?? true);
    setBreathing(e.controlledBreathing ?? true);
    setOpen(true);
  }
  function row(e: FitnessEvidence, archived = false) {
    return (
      <article key={e.id} className="fitness-evidence-row">
        <strong>
          {e.kind === "threshold"
            ? "Threshold reference"
            : "Base-run observation"}{" "}
          · {e.heartRate} bpm
        </strong>
        <p className="small-text">
          {e.source.replaceAll("_", " ")} ·{" "}
          {e.observedOn
            ? `measured/observed ${e.observedOn}`
            : "measurement date unknown"}{" "}
          · reported {e.reportedAt.slice(0, 10)}
          {e.paceSeconds ? ` · ${formatPace(e.paceSeconds)}/km` : ""}
          {e.powerWatts ? ` · ${e.powerWatts} W running` : ""}
          {e.wattsPerKg ? ` · ${e.wattsPerKg} W/kg` : ""}
          {e.kind === "base_observation"
            ? ` · comfortable speech: ${e.comfortableTalk ? "yes" : "no"} · controlled breathing: ${e.controlledBreathing ? "yes" : "no"}`
            : ""}
          {e.device ? ` · ${e.device}` : ""}
          {e.sensor ? ` · ${e.sensor}` : ""}
        </p>
        <div className="action-row">
          {!archived && (
            <Button
              className="button-secondary"
              disabled={pending}
              onClick={() => edit(e)}
            >
              Edit evidence
            </Button>
          )}
          <Button
            className="button-secondary"
            disabled={pending}
            onClick={() =>
              void save({ action: archived ? "restore" : "archive", id: e.id })
            }
          >
            {archived ? "Restore evidence" : "Archive evidence"}
          </Button>
        </div>
      </article>
    );
  }
  return (
    <section
      className="surface screen-stack"
      aria-labelledby="fitness-evidence-heading"
    >
      <div>
        <span className="eyebrow">WHAT YOUR COACH KNOWS</span>
        <h2 id="fitness-evidence-heading">Fitness evidence</h2>
        <p className="muted small-text">
          Dated measurements and observations stay with your training history.
          Garmin estimates and self-reports remain distinct from lab tests.
          Unknown dates stay unknown. Saving evidence does not certify zones or
          change your targets.
        </p>
      </div>
      {active.length ? (
        <details className="supporting-details" open>
          <summary>
            {active.length} active evidence record
            {active.length === 1 ? "" : "s"}
          </summary>
          {active.map((e) => row(e))}
        </details>
      ) : (
        <p>
          No structured fitness evidence yet. Add a threshold estimate or a
          comfortable-conversation observation.
        </p>
      )}
      <Button
        className="button-secondary"
        onClick={() => {
          setEditing(null);
          setKind("threshold");
          setSource("garmin_estimate");
          setDate("");
          setHr("");
          setPace("");
          setPower("");
          setRelative("");
          setDevice("");
          setSensor("");
          setOpen(true);
        }}
      >
        Add fitness evidence
      </Button>
      {open && (
        <form
          className="screen-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const common = {
              kind,
              observedOn: date || null,
              heartRate: Number(hr),
              device,
              sensor,
            };
            void save({
              action: "save",
              ...(editing ? { id: editing } : {}),
              evidence:
                kind === "threshold"
                  ? {
                      ...common,
                      source:
                        source === "self_report" ? "garmin_estimate" : source,
                      paceSeconds: parsePace(pace),
                      powerWatts: power ? Number(power) : null,
                      wattsPerKg: relative ? Number(relative) : null,
                    }
                  : {
                      ...common,
                      source: "self_report",
                      comfortableTalk: talk,
                      controlledBreathing: breathing,
                    },
            });
          }}
        >
          <div className="training-form editor-fields">
            <label>
              Evidence type
              <select
                disabled={!!editing}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as FitnessEvidence["kind"]);
                  setSource(
                    e.target.value === "threshold"
                      ? "garmin_estimate"
                      : "self_report",
                  );
                }}
              >
                <option value="threshold">Lactate-threshold reference</option>
                <option value="base_observation">
                  Comfortable base-run observation
                </option>
              </select>
            </label>
            <label>
              Measurement/observation date · optional
              <input
                type="date"
                max={today}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Heart rate · bpm
              <input
                type="number"
                min="60"
                max="230"
                required
                value={hr}
                onChange={(e) => setHr(e.target.value)}
              />
            </label>
            {kind === "threshold" && (
              <>
                <label>
                  Source
                  <select
                    value={source}
                    onChange={(e) =>
                      setSource(e.target.value as FitnessEvidence["source"])
                    }
                  >
                    <option value="garmin_estimate">
                      Garmin estimate · reported by you
                    </option>
                    <option value="field_test">Field test</option>
                    <option value="lab_test">Laboratory measurement</option>
                  </select>
                </label>
                <label>
                  Threshold pace · min:sec/km
                  <input
                    required
                    pattern="[0-9]{1,2}:[0-5][0-9]"
                    placeholder="5:00"
                    value={pace}
                    onChange={(e) => setPace(e.target.value)}
                  />
                </label>
                <label>
                  Running power · W, optional
                  <input
                    type="number"
                    min="1"
                    max="1500"
                    step="any"
                    value={power}
                    onChange={(e) => setPower(e.target.value)}
                  />
                </label>
                <label>
                  Running power · W/kg, optional
                  <input
                    type="number"
                    min="0.01"
                    max="20"
                    step="any"
                    value={relative}
                    onChange={(e) => setRelative(e.target.value)}
                  />
                </label>
              </>
            )}
            <label>
              Device · optional
              <input
                maxLength={80}
                value={device}
                onChange={(e) => setDevice(e.target.value)}
              />
            </label>
            <label>
              HR sensor · optional
              <input
                maxLength={80}
                value={sensor}
                onChange={(e) => setSensor(e.target.value)}
              />
            </label>
          </div>
          {kind === "base_observation" && (
            <>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={talk}
                  onChange={(e) => setTalk(e.target.checked)}
                />
                Comfortable full-sentence conversation at this HR
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={breathing}
                  onChange={(e) => setBreathing(e.target.checked)}
                />
                Breathing felt slow and controlled
              </label>
            </>
          )}
          <p className="muted small-text">
            Leave the date empty if you only know the measurement is recent.
            Running watts are separate from cycling FTP. An edit preserves the
            earlier record in archived history.
          </p>
          <div className="action-row">
            <Button disabled={pending}>
              {editing ? "Save evidence revision" : "Save evidence"}
            </Button>
            <Button
              type="button"
              className="button-secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {archived.length > 0 && (
        <details className="supporting-details">
          <summary>Archived evidence · {archived.length}</summary>
          {archived.map((e) => row(e, true))}
        </details>
      )}
      {message && (
        <p
          className={error ? "error-text" : "success-text"}
          role={error ? "alert" : "status"}
        >
          {message}
        </p>
      )}
    </section>
  );
}
