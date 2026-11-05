"use client";
import { applyAvailability } from "@/shared/schedule-editing";
import { TrainingCalendarManager } from "./TrainingCalendarManager";
import { applyCommitments, calendarGate } from "@/shared/commitment-calendar";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TrainingDashboardData } from "@/server/training/dashboard";
import {
  createTrainingPlan,
  formatPace,
  planKm,
  minimumRunKm,
  volumeMilestones,
  workoutKm,
} from "@/shared/training-plan";
import { developedPlan } from "@/shared/plan-development";
import { WeeklyLoadReview } from "./WeeklyLoadReview";
import { sameWorkout } from "@/shared/workout-identity";
import { Button } from "@/components/atoms/Button";
import { StatusBadge } from "@/components/atoms/StatusBadge";

import { WeeklySchedule } from "./WeeklySchedule";
import { buildWeekSchedule } from "@/shared/weekly-schedule";
import { DEFAULT_WEEK_PREFERENCES } from "@/shared/types/schedule";

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
function matchesGeneratedWeek(
  plan: NonNullable<TrainingDashboardData["previewPlan"]>,
) {
  try {
    const generated = createTrainingPlan(
      plan.weekNumber,
      plan.start,
      plan.easyPace,
      plan.tempoPace,
      plan.targetKm,
      plan.development,
    );
    return (
      plan.workouts.length === generated.workouts.length &&
      plan.workouts.every((w) =>
        generated.workouts.some((next) => sameWorkout(w, next)),
      )
    );
  } catch {
    return false;
  }
}
export function TrainingWorkspace({ data }: { data: TrainingDashboardData }) {
  const router = useRouter(),
    initial = data.previewPlan;
  const [week, setWeek] = useState(initial?.weekNumber ?? 1),
    [start, setStart] = useState(initial?.start ?? offset(data.monday, 7)),
    [targetKm, setTargetKm] = useState(String(initial?.targetKm ?? 25));
  const [easy, setEasy] = useState(
      formatPace(initial?.easyPace ?? data.athlete.easyPace),
    ),
    [tempo, setTempo] = useState(
      formatPace(initial?.tempoPace ?? data.athlete.tempoPace),
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
    initial && matchesGeneratedWeek(initial)
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
    preview = developedPlan(
      {
        weekNumber: week,
        start,
        easyPace: parsePace(easy),
        tempoPace: parsePace(tempo),
        targetKm: Number(targetKm),
      },
      data.athlete,
      data.plans,
      data.development,
    );
  } catch {
    /* Shown next to settings. */
  }
  const saved =
    preview &&
    !data.commitments.pauses.some(
      (p) => !p.cancelled && p.staleWeeks?.includes(start),
    ) &&
    data.plans.some(
      (p) =>
        p.start === start &&
        p.weekNumber === week &&
        p.targetKm === preview.targetKm &&
        p.easyPace === preview.easyPace &&
        p.tempoPace === preview.tempoPace,
    ) &&
    (data.plans.find((p) => p.start === start)?.workouts ?? []).every((w) =>
      preview!.workouts.some((next) => sameWorkout(w, next)),
    ) &&
    (savedKey ===
      settingsKey(
        start,
        week,
        preview.targetKm,
        preview.easyPace,
        preview.tempoPace,
      ) ||
      !!data.reviewedCalendars[start]);
  const calendar = preview
    ? saved && data.reviewedCalendars[start]
      ? data.reviewedCalendars[start]
      : applyAvailability(
          applyCommitments(
            buildWeekSchedule(
              preview,
              data.weekSettings[start] ?? DEFAULT_WEEK_PREFERENCES,
              data.preferences,
            ),
            preview,
            data.commitments,
            data.athlete.targets,
            data.calendarOptions,
          ),
          data.availability,
        )
    : null;
  const effectiveRuns =
    calendar?.days
      .flatMap((d) => d.sessions)
      .filter((s) => s.session.sport === "running") ?? [];
  const effectiveKm = effectiveRuns.reduce(
    (n, s) =>
      n +
      (s.session.sport === "running"
        ? workoutKm(s.session.workout, preview!.easyPace)
        : 0),
    0,
  );
  const gate = calendarGate(data.commitments, data.today, start);
  function viewDate(day: string, baseline = false) {
    const d = new Date(`${day}T12:00:00Z`),
      index = (d.getUTCDay() + 6) % 7;
    const monday = offset(day, -index);
    const p = data.plans.find((p) => p.start === monday) ?? initial;
    setStart(monday < data.monday ? data.monday : monday);
    setWeek(p?.weekNumber ?? 1);
    setTargetKm(String(baseline ? 20 : (p?.targetKm ?? 25)));
    setEasy(formatPace(p?.easyPace ?? data.athlete.easyPace));
    setTempo(formatPace(p?.tempoPace ?? data.athlete.tempoPace));
    setSelectedDay(monday < data.monday ? 0 : index);
    requestAnimationFrame(() =>
      document.getElementById("day-schedule-heading")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      }),
    );
  }

  return (
    <section className="screen-stack" aria-label="Weekly workout planner">
      <TrainingCalendarManager data={data} onView={viewDate} />
      {gate.blocked && (
        <p className="inline-notice small-text">{gate.reason}</p>
      )}
      {initial &&
        initial.start === start &&
        initial.weekNumber === week &&
        !matchesGeneratedWeek(initial) &&
        !saved && (
          <p className="inline-notice small-text">
            This is an updated distance-based draft. Review and save the week to
            apply it to the stored schedule.
          </p>
        )}
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
            {preview ? effectiveKm.toFixed(1) : "—"}
            <span>km planned</span>
          </strong>
          <strong>
            {preview ? effectiveRuns.length : "—"}
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
                max={offset(data.monday, 730)}
                value={start}
                onChange={(e) => setStart(e.target.value)}
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
              Every step uses distance, with at least 5 km per run including
              warm-up and cool-down. Tempo pace sets intensity. Volume increases
              still need a completed baseline and recovery check-ins.
            </p>
          </div>
        </details>
        <div className="action-row">
          <Button
            type="button"
            className="button-secondary"
            onClick={() => {
              setEasy(formatPace(data.athlete.easyPace));
              setTempo(formatPace(data.athlete.tempoPace));
            }}
          >
            Use athlete pace settings
          </Button>
          <Button
            type="button"
            className="button-secondary"
            onClick={() => {
              if (data.progression.suggestedKm !== null)
                setTargetKm(
                  String(
                    Math.min(
                      volumeMilestones[week - 1],
                      data.progression.suggestedKm,
                    ),
                  ),
                );
            }}
          >
            Use volume review suggestion
          </Button>
        </div>
        {!preview && (
          <p role="alert" className="error-text">
            Choose a valid date, tempo pace of 3:00–7:00/km, and volume from 20
            km up to the selected milestone in 0.01 km increments.
          </p>
        )}
        <div className="plan-save-row">
          <p className="muted small-text">
            Saving a changed week replaces daily adjustments. All steps use
            distance. Training runs total at least {minimumRunKm} km, including
            warm-up and cool-down. Races use the fixed course distance. The base
            week is {preview ? planKm(preview).toFixed(1) : "—"} km before race
            and break adjustments.
          </p>
          <Button disabled={pending || !preview || !!saved} type="submit">
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
        <WeeklyLoadReview
          plan={preview}
          calendar={calendar!}
          load={data.load}
          development={data.development}
        />
      )}
      {preview && (
        <WeeklySchedule
          key={start}
          plan={preview}
          calendar={calendar!}
          initialWeek={data.weekSettings[start] ?? DEFAULT_WEEK_PREFERENCES}
          saved={!!saved}
          today={data.today}
          selectedDay={selectedDay}
          onSelect={setSelectedDay}
        />
      )}
    </section>
  );
}
