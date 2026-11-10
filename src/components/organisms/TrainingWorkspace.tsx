"use client";
import { applyAvailability } from "@/shared/schedule-editing";
import { WeekNavigator } from "../molecules/WeekNavigator";
import { RaceWeekNotice } from "../molecules/RaceWeekNotice";
import {
  weekView,
  weekMonday,
  attendanceForWeek,
  planDayFromQuery,
} from "@/shared/week-view";
import { WeeklyPlanReview } from "./WeeklyPlanReview";
import type { TrainingPlan } from "@/shared/types/metrics";
import Link from "next/link";
import { applyCommitments, calendarGate } from "@/shared/commitment-calendar";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  const query = useSearchParams();
  const requestedDay = planDayFromQuery(
    query.get("date"),
    [data.monday, ...data.plans.map((p) => p.start)].sort()[0],
    weekMonday(offset(data.monday, 730)),
  );
  return (
    <TrainingWeekEditor
      key={requestedDay ?? "current"}
      data={data}
      requestedDay={requestedDay}
    />
  );
}
function TrainingWeekEditor({
  data,
  requestedDay,
}: {
  data: TrainingDashboardData;
  requestedDay?: string;
}) {
  const router = useRouter(),
    initial = requestedDay
      ? weekView(weekMonday(requestedDay), {
          monday: data.monday,
          plans: data.plans,
          prepared: data.weeklyRecommendation.selected.plan,
          athlete: data.athlete,
        }).plan
      : data.previewPlan;
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
    (Date.parse(`${requestedDay ?? data.today}T12:00:00Z`) -
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
  const prepared = data.weeklyRecommendation.selected;
  const view = weekView(start, {
    monday: data.monday,
    plans: data.plans,
    prepared: prepared.plan,
    athlete: data.athlete,
  });
  const viewAttendance = attendanceForWeek(
    start,
    data.weekSettings,
    data.monday,
    prepared.preferences,
  );
  const matchesView =
    week === view.plan.weekNumber &&
    Number(targetKm) === view.plan.targetKm &&
    parsePace(easy) === view.plan.easyPace &&
    parsePace(tempo) === view.plan.tempoPace;
  const readOnlyView =
    matchesView &&
    (view.kind === "projection" ||
      start < data.monday ||
      view.kind === "unplanned");
  const matchesPrepared =
    start === prepared.plan.start &&
    week === prepared.plan.weekNumber &&
    Number(targetKm) === prepared.plan.targetKm &&
    parsePace(easy) === prepared.plan.easyPace &&
    parsePace(tempo) === prepared.plan.tempoPace;
  function loadPreparedWeek(plan: TrainingPlan = prepared.plan) {
    setStart(plan.start);
    setWeek(plan.weekNumber);
    setTargetKm(String(plan.targetKm));
    setEasy(formatPace(plan.easyPace));
    setTempo(formatPace(plan.tempoPace));
    const index = Math.round(
      (Date.parse(data.today + "T12:00:00Z") -
        Date.parse(plan.start + "T12:00:00Z")) /
        86400000,
    );
    setSelectedDay(index >= 0 && index < 7 ? index : 0);
  }
  let preview = null;
  try {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
      !Number.isFinite(Date.parse(`${start}T12:00:00Z`))
    )
      throw new Error("Choose a date");
    preview = matchesView
      ? view.plan
      : matchesPrepared
        ? prepared.plan
        : developedPlan(
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
            buildWeekSchedule(preview, viewAttendance, data.preferences),
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
  function browseWeek(monday: string) {
    const next = weekView(monday, {
      monday: data.monday,
      plans: data.plans,
      prepared: prepared.plan,
      athlete: data.athlete,
    });
    loadPreparedWeek(next.plan);
    setMessage("");
  }

  return (
    <section className="screen-stack" aria-label="Weekly workout planner">
      <WeekNavigator
        start={start}
        current={data.monday}
        min={[data.monday, ...data.plans.map((p) => p.start)].sort()[0]}
        max={weekMonday(offset(data.monday, 730))}
        onChange={(monday) => browseWeek(monday)}
      />
      {start === data.monday && (
        <WeeklyPlanReview
          planning={data.weeklyRecommendation}
          matches={matchesPrepared}
          onUse={() => loadPreparedWeek()}
          onAccepted={(plan) => {
            loadPreparedWeek(plan);
            setSavedKey(
              settingsKey(
                plan.start,
                plan.weekNumber,
                plan.targetKm,
                plan.easyPace,
                plan.tempoPace,
              ),
            );
            setMessage("Your week is active. No daily check-in is required.");
          }}
        />
      )}
      <Link href="/events" className="text-link plan-events-link">
        Races & training breaks →
      </Link>
      {preview && (
        <RaceWeekNotice
          start={start}
          races={data.commitments.races}
          baseKm={planKm(preview)}
          effectiveKm={effectiveKm}
        />
      )}
      {gate.blocked &&
        (start === data.monday || calendar?.days.some((d) => !!d.rule)) && (
          <p className="inline-notice small-text">{gate.reason}</p>
        )}
      {initial &&
        initial.start === start &&
        initial.weekNumber === week &&
        !matchesGeneratedWeek(initial) &&
        data.plans.some((p) => p.start === initial.start) &&
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
            {saved
              ? "Reviewed week"
              : view.kind === "projection" && matchesView
                ? "Future preview"
                : start < data.monday
                  ? "Past week"
                  : "Draft preview"}
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
        {readOnlyView && (
          <p className="inline-notice small-text">
            {start < data.monday
              ? "Past week · browsing keeps its saved steps and history intact."
              : "Future preview · mileage is held at the latest baseline, with race and break rules applied. Stage and distance are provisional; the coach prepares the final week from completed training."}{" "}
            Browsing does not save or activate a week.
          </p>
        )}
        <p className="muted small-text">
          Stage {week} ceiling: {volumeMilestones[week - 1]} km · baseline:{" "}
          {preview ? planKm(preview).toFixed(1) : "—"} km
          {Math.abs(effectiveKm - (preview ? planKm(preview) : 0)) > 0.01
            ? ` · calendar after adjustments: ${effectiveKm.toFixed(1)} km`
            : ""}
        </p>
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
              use completed training and available recovery evidence. Daily
              check-ins are optional.
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
          {!readOnlyView &&
            start >= data.monday &&
            !(data.weeklyRecommendation.needsApproval && matchesPrepared) && (
              <Button disabled={pending || !preview || !!saved} type="submit">
                {pending ? "Saving…" : "Save edited week"}
              </Button>
            )}
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
          initialWeek={viewAttendance}
          saved={!!saved}
          today={data.today}
          selectedDay={selectedDay}
          onSelect={setSelectedDay}
        />
      )}
    </section>
  );
}
