"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TrainingDashboardData } from "@/server/training/dashboard";
import {
  createTrainingPlan,
  defaultEasyPace,
  defaultTempoPace,
  formatPace,
  planKm,
  stepSeconds,
  volumeMilestones,
  workoutKm,
} from "@/shared/training-plan";
import { sameWorkout } from "@/shared/workout-identity";
import { Button } from "@/components/atoms/Button";
import { PlanSteps } from "@/components/molecules/PlanSteps";
import { StatusBadge } from "@/components/atoms/StatusBadge";
import { Icon } from "@/components/atoms/Icon";
import { CopyWorkoutButton } from "@/components/molecules/CopyWorkoutButton";

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
function settingsKey(
  start: string,
  week: number,
  km: number,
  easy: number,
  tempo: number,
) {
  return [start, week, km, easy, tempo].join("|");
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
  const router = useRouter(),
    initial = data.previewPlan;
  const [week, setWeek] = useState(initial?.weekNumber ?? 1),
    [start, setStart] = useState(initial?.start ?? offset(data.monday, 7)),
    [targetKm, setTargetKm] = useState(String(initial?.targetKm ?? 25));
  const [easy, setEasy] = useState(
      formatPace(initial?.easyPace ?? defaultEasyPace),
    ),
    [tempo, setTempo] = useState(
      formatPace(initial?.tempoPace ?? defaultTempoPace),
    );
  const todayOffset = Math.round(
    (Date.parse(`${data.today}T12:00:00Z`) -
      Date.parse(`${initial?.start ?? offset(data.monday, 7)}T12:00:00Z`)) /
      86400000,
  );
  const [selectedDay, setSelectedDay] = useState(
    todayOffset >= 0 && todayOffset <= 6 ? todayOffset : 0,
  );
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  const [savedKey, setSavedKey] = useState(
    initial
      ? settingsKey(
          initial.start,
          initial.weekNumber,
          initial.targetKm,
          initial.easyPace,
          initial.tempoPace,
        )
      : null,
  );
  let preview = null;
  try {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
      !Number.isFinite(Date.parse(`${start}T12:00:00Z`))
    )
      throw new Error("Choose a date");
    preview = createTrainingPlan(
      week,
      start,
      parsePace(easy),
      parsePace(tempo),
      Number(targetKm),
    );
  } catch {
    /* Shown next to settings. */
  }
  const original = preview?.workouts.find((w) => w.dayOffset === selectedDay);
  const override = original
    ? data.overrides.find(
        (o) =>
          o.day === offset(start, selectedDay) &&
          sameWorkout(o.before, original),
      )
    : undefined;
  const workout = override ? override.workout : original;
  const saved =
    preview &&
    savedKey ===
      settingsKey(
        start,
        week,
        preview.targetKm,
        preview.easyPace,
        preview.tempoPace,
      );

  return (
    <section className="screen-stack" aria-label="Weekly running planner">
      <form
        className="surface plan-summary"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!preview) return;
          setPending(true);
          setMessage("");
          setFailed(false);
          try {
            const response = await fetch("/api/training/plan", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-coach-request": "local",
              },
              body: JSON.stringify({
                weekNumber: week,
                start,
                easyPace: preview.easyPace,
                tempoPace: preview.tempoPace,
                targetKm: preview.targetKm,
              }),
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(result.error ?? "Could not save this week.");
            setSavedKey(
              settingsKey(
                start,
                week,
                preview.targetKm,
                preview.easyPace,
                preview.tempoPace,
              ),
            );
            setMessage("Reviewed week saved.");
            router.refresh();
          } catch (error) {
            setFailed(true);
            setMessage(
              error instanceof Error
                ? error.message
                : "Could not save this week.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              STAGE {week} OF {volumeMilestones.length}
              {preview?.cutback ? " · CUTBACK" : ""}
            </span>
            <h2>
              Week of{" "}
              {/^\d{4}-\d{2}-\d{2}$/.test(start)
                ? new Date(`${start}T12:00:00Z`).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    timeZone: "UTC",
                  })
                : "—"}
            </h2>
          </div>
          <StatusBadge tone={saved ? "success" : "info"}>
            {saved ? "Reviewed week" : "Draft preview"}
          </StatusBadge>
        </div>
        <div className="plan-totals">
          <strong>
            {preview ? `≈${planKm(preview).toFixed(1)}` : "—"}
            <span>km planned</span>
          </strong>
          <strong>
            {preview?.workouts.length ?? "—"}
            <span>running days</span>
          </strong>
          <span className="muted small-text">
            {preview?.cutback
              ? "Cutback week · room to recover"
              : "Build gradually. Review before progressing."}
          </span>
        </div>
        <details className="plan-settings">
          <summary>Adjust week & pace settings</summary>
          <div className="training-form editor-fields">
            <label htmlFor="milestone">
              Milestone stage
              <select
                id="milestone"
                value={week}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setWeek(n);
                  setTargetKm(String(volumeMilestones[n - 1]));
                  setStart(
                    offset(
                      initial?.start ?? offset(data.monday, 7),
                      (n - (initial?.weekNumber ?? 1)) * 7,
                    ),
                  );
                  setSelectedDay(0);
                }}
              >
                {volumeMilestones.map((km, i) => (
                  <option key={i} value={i + 1}>
                    Stage {i + 1} · ≈{km} km{i % 4 === 3 ? " · cutback" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="reviewed-volume">
              Reviewed running volume · km
              <input
                id="reviewed-volume"
                type="number"
                required
                min={20}
                max={volumeMilestones[week - 1]}
                step="0.1"
                value={targetKm}
                onChange={(e) => setTargetKm(e.target.value)}
              />
            </label>
            <label htmlFor="plan-start">
              Week starting · Monday
              <input
                id="plan-start"
                type="date"
                required
                min={data.monday}
                max={offset(data.monday, 210)}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label htmlFor="easy-estimate">
              Planning pace for HR steps
              <input
                id="easy-estimate"
                value={easy}
                required
                pattern="[0-9]{1,2}:[0-5][0-9]"
                onChange={(e) => setEasy(e.target.value)}
              />
            </label>
            <label htmlFor="tempo-pace">
              Tempo working pace · min:sec/km
              <input
                id="tempo-pace"
                value={tempo}
                required
                pattern="[0-9]{1,2}:[0-5][0-9]"
                onChange={(e) => setTempo(e.target.value)}
              />
            </label>
            <p className="muted small-text editor-note">
              The planning pace estimates HR-step duration. An increase needs a
              completed baseline and recovery check-ins; milestones stay drafts
              until reviewed.
            </p>
          </div>
        </details>
        {!preview && (
          <p role="alert" className="error-text">
            Check the settings: planning pace 4:00–10:00/km, tempo 3:00–7:00/km,
            and volume from 20 km up to the selected milestone.
          </p>
        )}
        <div className="plan-save-row">
          <p className="muted small-text">
            Distances include every step. Time-based distances are estimates.
          </p>
          <Button disabled={pending || !preview} type="submit">
            {pending ? "Saving…" : "Save reviewed week"}
          </Button>
        </div>
      </form>
      {message && (
        <p
          role={failed ? "alert" : "status"}
          className={`inline-notice ${failed ? "error-text" : "success-text"}`}
        >
          {message}
        </p>
      )}
      {preview && (
        <>
          <div
            className="week-strip"
            role="group"
            aria-label="Choose a workout day"
          >
            {names.map((name, i) => {
              const run = preview.workouts.find((w) => w.dayOffset === i),
                edit = data.overrides.find(
                  (o) =>
                    o.day === offset(start, i) &&
                    run &&
                    sameWorkout(o.before, run),
                ),
                effective = edit ? edit.workout : run;
              return (
                <button
                  type="button"
                  key={name}
                  aria-label={`${name}${effective ? ` · ${effective.title}` : " · no run"}`}
                  aria-pressed={selectedDay === i}
                  onClick={() => setSelectedDay(i)}
                >
                  <span>{name.slice(0, 3)}</span>
                  <strong>
                    {new Date(`${offset(start, i)}T12:00:00Z`).getUTCDate()}
                  </strong>
                  <small>
                    {effective
                      ? `${workoutKm(effective, preview.easyPace).toFixed(1)}k`
                      : "Off"}
                  </small>
                  <span className={`day-dot ${effective ? "has-run" : ""}`} />
                </button>
              );
            })}
          </div>
          <article
            className="surface selected-workout"
            aria-labelledby="selected-workout-heading"
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  {names[selectedDay]} · {offset(start, selectedDay)}
                </span>
                <h2 id="selected-workout-heading">
                  {workout ? workout.title : "No run scheduled"}
                </h2>
              </div>
              <span className="workout-symbol">
                <Icon name={workout ? "plan" : "heart"} />
              </span>
            </div>
            {override && (
              <p className="inline-notice small-text">
                Approved daily adjustment. Weekly totals retain the reviewed
                baseline.
              </p>
            )}
            {workout ? (
              <>
                <div className="workout-meta">
                  <span>
                    ≈{workoutKm(workout, preview.easyPace).toFixed(1)} km
                  </span>
                  <span>
                    ≈
                    {Math.round(
                      workout.steps.reduce(
                        (sum, s) => sum + stepSeconds(s, preview.easyPace),
                        0,
                      ) / 60,
                    )}{" "}
                    min
                  </span>
                  <span>Garmin-ready steps</span>
                </div>
                <PlanSteps steps={workout.steps} />
                <CopyWorkoutButton workout={workout} />
              </>
            ) : (
              <p className="muted rest-message">
                {override
                  ? "Rest from running today. This change has been approved."
                  : selectedDay === 6
                    ? "A day to recover. Your next running week starts on Monday."
                    : "Follow your other scheduled training and leave room for recovery."}
              </p>
            )}
          </article>
          <details className="surface supporting-details">
            <summary>How this week fits your other training</summary>
            <p className="muted">
              Monday and Wednesday Hyrox; Tuesday and Thursday Zwift; Saturday
              cycling.{" "}
              {preview.workouts.length >= 5
                ? "Wednesday includes a short run; separate the sessions and allow recovery. "
                : ""}
              {preview.workouts.length >= 6
                ? "Friday becomes a running day: drop Friday Hyrox and review the long Saturday ride. "
                : "Friday running is off by default. "}
              Higher stages need longer lunch windows. Sunday remains a rest
              day.
            </p>
            <p className="muted small-text">
              The 30 stages are milestone ceilings, not an automatic 30-week
              timeline. Progression depends on completed training and recovery.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
