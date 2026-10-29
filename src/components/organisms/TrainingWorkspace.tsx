"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TrainingDashboardData } from "@/server/training/dashboard";
import {
  createTrainingPlan,
  defaultEasyPace,
  defaultTempoPace,
  formatPace,
  garminWorkoutText,
  planKm,
  stepSeconds,
  volumeMilestones,
  workoutKm,
} from "@/shared/training-plan";
import { Button } from "@/components/atoms/Button";
import { TextInput } from "@/components/atoms/TextInput";
import { PlanSteps } from "@/components/molecules/PlanSteps";
import { StatusBadge } from "@/components/atoms/StatusBadge";

function offset(day: string, days: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function parsePace(value: string) {
  if (!/^\d{1,2}:[0-5]\d$/.test(value)) return NaN;
  const [m, s] = value.split(":").map(Number);
  return m * 60 + s;
}
const names = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function TrainingWorkspace({ data }: { data: TrainingDashboardData }) {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [week, setWeek] = useState(data.previewPlan?.weekNumber ?? 1);
  const [start, setStart] = useState(
    data.previewPlan?.start ?? offset(data.monday, 7),
  );
  const [targetKm, setTargetKm] = useState(
    String(data.previewPlan?.targetKm ?? 25),
  );
  const [easy, setEasy] = useState(
    formatPace(data.previewPlan?.easyPace ?? defaultEasyPace),
  );
  const [tempo, setTempo] = useState(
    formatPace(data.previewPlan?.tempoPace ?? defaultTempoPace),
  );
  const [day, setDay] = useState(data.today);
  const [fatigue, setFatigue] = useState(
    String(data.todayCheckIn?.fatigue ?? ""),
  );
  const [soreness, setSoreness] = useState(
    String(data.todayCheckIn?.soreness ?? ""),
  );
  const [pain, setPain] = useState(String(data.todayCheckIn?.pain ?? ""));
  const [notes, setNotes] = useState(data.todayCheckIn?.notes ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  let preview = null;
  try {
    const ep = parsePace(easy),
      tp = parsePace(tempo);
    if (Number.isFinite(ep) && Number.isFinite(tp))
      preview = createTrainingPlan(week, start, ep, tp, Number(targetKm));
  } catch {
    /* Validation is shown next to the controls. */
  }

  async function save(path: string, body: unknown) {
    setPending(true);
    setFailed(false);
    setMessage("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-secret": secret,
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not save. Retry.");
      setMessage("Saved.");
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="training-section"
      id="plan"
      aria-labelledby="plan-heading"
    >
      <div className="section-heading">
        <h2 id="plan-heading">Plan & recovery check-in</h2>
        <StatusBadge>Manual review</StatusBadge>
      </div>
      <div className="surface workspace-auth">
        <label htmlFor="training-passphrase">Action passphrase</label>
        <TextInput
          id="training-passphrase"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="off"
          placeholder="Same passphrase used to sync Garmin"
        />
        <p className="muted small-text">
          Used to save check-ins and reviewed weeks. Kept in page memory only.
        </p>
        <p
          role={failed ? "alert" : "status"}
          aria-live="polite"
          className={failed ? "error-text" : "muted"}
        >
          {message}
        </p>
      </div>
      <div className="dashboard-grid">
        <form
          className="surface training-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save("/api/training/check-in", {
              day,
              fatigue: Number(fatigue),
              soreness: Number(soreness),
              pain: Number(pain),
              notes,
            });
          }}
        >
          <h3>How do you feel?</h3>
          <label htmlFor="check-day">Date</label>
          <TextInput
            id="check-day"
            type="date"
            required
            min={offset(data.today, -14)}
            max={data.today}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
          <label htmlFor="fatigue">Fatigue · 1 fresh → 5 exhausted</label>
          <select
            id="fatigue"
            required
            value={fatigue}
            onChange={(e) => setFatigue(e.target.value)}
          >
            <option value="">Choose a score</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <label htmlFor="soreness">Muscle soreness · 1 none → 5 severe</label>
          <select
            id="soreness"
            required
            value={soreness}
            onChange={(e) => setSoreness(e.target.value)}
          >
            <option value="">Choose a score</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <label htmlFor="pain">Pain · 0 none → 10 severe</label>
          <select
            id="pain"
            required
            value={pain}
            onChange={(e) => setPain(e.target.value)}
          >
            <option value="">Choose a score</option>
            {Array.from({ length: 11 }, (_, n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <label htmlFor="check-notes">Notes · optional</label>
          <textarea
            id="check-notes"
            maxLength={300}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Legs, sleep, or anything affecting training"
          />
          <Button type="submit" disabled={pending || secret.length < 16}>
            {pending ? "Saving…" : "Save check-in"}
          </Button>
          <p className="muted small-text">
            {
              data.checkIns.filter(
                (c) => c.day >= offset(data.today, -6) && c.day <= data.today,
              ).length
            }{" "}
            check-ins in the last 7 days. A saved check-in can be updated for
            the same date.
          </p>
        </form>
        <form
          className="surface training-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (preview)
              void save("/api/training/plan", {
                weekNumber: week,
                start,
                easyPace: preview.easyPace,
                tempoPace: preview.tempoPace,
                targetKm: preview.targetKm,
              });
          }}
        >
          <h3>30-week milestone preview</h3>
          <p className="muted">
            Future milestones remain drafts. Progression depends on completed
            training and recovery, so 80 km has no guaranteed completion date.
          </p>
          <label htmlFor="milestone">Preview stage</label>
          <select
            id="milestone"
            value={week}
            onChange={(e) => {
              const n = Number(e.target.value);
              setWeek(n);
              setTargetKm(String(volumeMilestones[n - 1]));
              setStart(
                offset(
                  data.previewPlan?.start ?? offset(data.monday, 7),
                  (n - (data.previewPlan?.weekNumber ?? 1)) * 7,
                ),
              );
            }}
          >
            {volumeMilestones.map((km, i) => (
              <option key={i} value={i + 1}>
                Stage {i + 1} · ≈{km} km{i % 4 === 3 ? " · cutback" : ""}
              </option>
            ))}
          </select>
          <label htmlFor="reviewed-volume">Reviewed running volume · km</label>
          <TextInput
            id="reviewed-volume"
            type="number"
            required
            min={20}
            max={volumeMilestones[week - 1]}
            step="0.1"
            value={targetKm}
            onChange={(e) => setTargetKm(e.target.value)}
          />
          <p className="muted small-text">
            Choose a value up to this milestone, using the volume review above.
            An increase requires a completed baseline and recovery check-ins.
            The first draft starts next Monday to avoid adding another quality
            run to this week.
          </p>
          <label htmlFor="plan-start">Week starting · Monday</label>
          <TextInput
            id="plan-start"
            type="date"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
            min={data.monday}
            max={offset(data.monday, 210)}
          />
          <label htmlFor="easy-estimate">
            Planning pace for HR steps · min:sec/km
          </label>
          <TextInput
            id="easy-estimate"
            inputMode="text"
            value={easy}
            onChange={(e) => setEasy(e.target.value)}
            required
            pattern="[0-9]{1,2}:[0-5][0-9]"
          />
          <label htmlFor="tempo-pace">Tempo working pace · min:sec/km</label>
          <TextInput
            id="tempo-pace"
            value={tempo}
            onChange={(e) => setTempo(e.target.value)}
            required
            pattern="[0-9]{1,2}:[0-5][0-9]"
          />
          <p className="muted small-text">
            The planning pace estimates duration for HR steps; it does not
            become a pace prescription. Tempo pace is a working setting to
            review against completed runs.
          </p>
          {!preview && (
            <p role="alert" className="error-text">
              Use an HR planning pace of 4:00–10:00/km, tempo pace of
              3:00–7:00/km, and volume from 20 km up to the selected milestone.
            </p>
          )}
          {preview && (
            <p>
              <strong>
                ≈{planKm(preview).toFixed(1)} km · {preview.workouts.length}{" "}
                runs
              </strong>
              <br />
              <span className="muted small-text">
                Calculated from every warm-up, run, repeat, recovery and
                cool-down below. Time-based distances are estimates using the
                midpoint of their pace range.
              </span>
            </p>
          )}
          <Button
            type="submit"
            disabled={pending || !preview || secret.length < 16}
          >
            {pending ? "Saving…" : "Save reviewed week"}
          </Button>
        </form>
      </div>
      {preview && (
        <>
          <p className="muted schedule-note">
            Monday and Wednesday Hyrox; Tuesday and Thursday Zwift; Saturday
            cycling.{" "}
            {preview.workouts.length >= 5
              ? "Wednesday now includes a short run; allow separate sessions and recovery. "
              : ""}
            {preview.workouts.length >= 6
              ? "Friday is a running day: drop Friday Hyrox and review the long Saturday ride. "
              : "Friday running is off by default. "}
            Higher stages need longer lunch windows. Sunday remains a rest day.
          </p>
          <div className="workout-grid">
            {preview.workouts.map((workout) => (
              <article className="surface" key={workout.dayOffset}>
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">
                      {names[workout.dayOffset]} ·{" "}
                      {offset(start, workout.dayOffset)}
                    </span>
                    <h3>{workout.title}</h3>
                  </div>
                  <StatusBadge>
                    ≈{workoutKm(workout, preview.easyPace).toFixed(1)} km
                  </StatusBadge>
                </div>
                <p className="muted small-text">
                  Estimated{" "}
                  {Math.round(
                    workout.steps.reduce(
                      (sum, s) => sum + stepSeconds(s, preview.easyPace),
                      0,
                    ) / 60,
                  )}{" "}
                  min
                </p>
                <PlanSteps steps={workout.steps} />
                <Button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        garminWorkoutText(workout),
                      );
                      setFailed(false);
                      setMessage("Garmin steps copied.");
                    } catch {
                      setFailed(true);
                      setMessage(
                        "Clipboard unavailable. The steps are displayed above for manual entry.",
                      );
                    }
                  }}
                >
                  Copy Garmin steps
                </Button>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
