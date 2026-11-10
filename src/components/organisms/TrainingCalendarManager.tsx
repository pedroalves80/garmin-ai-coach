"use client";
import { raceImpactWeeks, compareRaceImpact } from "@/shared/race-impact";
import { weekView, attendanceForWeek } from "@/shared/week-view";
import { raceWindow } from "@/shared/commitment-calendar";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TrainingDashboardData } from "@/server/training/dashboard";
import type { RaceEvent, TrainingPause } from "@/shared/types/commitments";
import {
  daysBetween,
  applyCommitments,
  pauseActive,
  pendingReturn,
} from "@/shared/commitment-calendar";
import { createTrainingPlan, workoutKm } from "@/shared/training-plan";
import { buildWeekSchedule, dayOffsetDate } from "@/shared/weekly-schedule";
import { DEFAULT_WEEK_PREFERENCES } from "@/shared/types/schedule";
import { Button } from "../atoms/Button";
function monday(day: string) {
  const n = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dayOffsetDate(day, -((n + 6) % 7));
}
export function TrainingCalendarManager({
  data,
  onView,
}: {
  data: TrainingDashboardData;
  onView: (day: string, baseline?: boolean) => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"race" | "pause" | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(false);
  const [name, setName] = useState(""),
    [day, setDay] = useState(dayOffsetDate(data.today, 14)),
    [time, setTime] = useState(""),
    [distance, setDistance] = useState("10"),
    [terrain, setTerrain] = useState<"road" | "trail">("road"),
    [elevation, setElevation] = useState(""),
    [minutes, setMinutes] = useState("60"),
    [priority, setPriority] = useState<"goal" | "training">("goal");
  const [start, setStart] = useState(data.today),
    [end, setEnd] = useState(""),
    [reason, setReason] = useState<TrainingPause["reason"]>("travel");
  const maxDate = dayOffsetDate(data.today, 730);
  const draftRace: RaceEvent = {
    id: editing ?? "preview",
    name: name.trim() || "Race preview",
    day,
    startTime: time || null,
    distanceKm: Number(distance),
    terrain,
    elevationGain: elevation ? Number(elevation) : null,
    expectedMinutes: Number(minutes),
    priority,
    status: "planned",
    createdAt: "",
    updatedAt: "",
  };
  const draftPause: TrainingPause = {
    id: "preview",
    start,
    end: end || null,
    reason,
    cancelled: false,
    resumeOn: null,
    returnReviewedAt: null,
    createdAt: "",
  };
  const previewDay = mode === "race" ? day : start;
  let summary: null | {
    start: string;
    km: number;
    runs: number;
    removed: number;
    notes: string[];
  } = null;
  try {
    if (
      mode &&
      /^\d{4}-\d{2}-\d{2}$/.test(previewDay) &&
      Number(distance) >= 1 &&
      Number(distance) <= 100
    ) {
      const week = monday(previewDay),
        reference =
          data.plans.find((p) => p.start === week) ?? data.previewPlan;
      const plan = reference
        ? { ...reference, start: week }
        : createTrainingPlan(
            1,
            week,
            data.athlete.easyPace,
            data.athlete.tempoPace,
            25,
          );
      const original = buildWeekSchedule(
        plan,
        data.weekSettings[week] ?? DEFAULT_WEEK_PREFERENCES,
        data.preferences,
      );
      const c =
        mode === "race"
          ? {
              ...data.commitments,
              races: [
                ...data.commitments.races.filter((r) => r.id !== editing),
                draftRace,
              ],
            }
          : {
              ...data.commitments,
              pauses: [...data.commitments.pauses, draftPause],
            };
      const result = applyCommitments(
        original,
        plan,
        c,
        data.athlete.targets,
        data.calendarOptions,
      );
      const runs = result.days
        .flatMap((d) => d.sessions)
        .filter((s) => s.session.sport === "running");
      summary = {
        start: week,
        km: runs.reduce(
          (n, s) =>
            n +
            (s.session.sport === "running"
              ? workoutKm(s.session.workout, plan.easyPace)
              : 0),
          0,
        ),
        runs: runs.length,
        removed: Math.max(
          0,
          original.days
            .flatMap((d) => d.sessions)
            .filter((s) => s.session.sport !== "running").length -
            result.days
              .flatMap((d) => d.sessions)
              .filter((s) => s.session.sport !== "running").length,
        ),
        notes: [
          ...new Set(
            result.days.flatMap((d) => [
              ...(d.rule?.notes ?? []),
              ...d.warnings,
            ]),
          ),
        ].slice(0, 4),
      };
    }
  } catch {
    /* Invalid form fields have native validation. */
  }
  let raceImpact: ReturnType<typeof compareRaceImpact>[] = [];
  if (mode === "race") {
    try {
      const next = {
        ...data.commitments,
        races: [
          ...data.commitments.races.filter((r) => r.id !== editing),
          draftRace,
        ],
      };
      raceImpact = raceImpactWeeks(
        draftRace,
        data.commitments.races.find((r) => r.id === editing),
        data.today,
      ).map((start) => {
        const plan = weekView(start, {
          monday: data.monday,
          plans: data.plans,
          prepared: data.weeklyRecommendation.selected.plan,
          athlete: data.athlete,
        }).plan;
        const baseline =
          data.calendarBaselines[start] ??
          buildWeekSchedule(
            plan,
            attendanceForWeek(
              start,
              data.weekSettings,
              data.monday,
              data.weeklyRecommendation.selected.preferences,
            ),
            data.preferences,
          );
        return compareRaceImpact({
          plan,
          baseline,
          before: data.commitments,
          after: next,
          targets: data.athlete.targets,
          options: data.calendarOptions,
          availability: data.availability,
        });
      });
    } catch {
      /* Invalid draft fields are handled by form validation. */
    }
  }
  async function save(body: object, viewDay?: string) {
    setPending(true);
    setMessage("");
    setError(false);
    try {
      const response = await fetch("/api/training/commitments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-coach-request": "local",
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? "Could not save calendar.");
      setMessage(
        "action" in body && body.action === "race"
          ? "Race saved. Preparation and recovery now apply to the weeks shown in the preview. You are still viewing the same week; use View race week to jump to the event."
          : "Calendar saved. The week and coach now use these commitments.",
      );
      setMode(null);
      setEditing(null);
      router.refresh();
      if (viewDay)
        onView(viewDay, "action" in body && body.action === "review_baseline");
    } catch (e) {
      setError(true);
      setMessage(e instanceof Error ? e.message : "Could not save calendar.");
    } finally {
      setPending(false);
    }
  }
  const races = data.commitments.races.filter(
    (r) => r.status !== "cancelled" && r.day >= dayOffsetDate(data.today, -14),
  );
  const pauses = data.commitments.pauses.filter(
    (p) =>
      !p.cancelled &&
      (!p.returnReviewedAt ||
        !p.baselineReviewedAt ||
        p.baselineReviewedAt >= dayOffsetDate(data.today, -7)),
  );
  return (
    <section
      className="surface calendar-manager"
      aria-labelledby="calendar-heading"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">PLAN AROUND LIFE</span>
          <h2 id="calendar-heading">Races & training breaks</h2>
        </div>
        <span className="muted small-text">Up to 2 years ahead</span>
      </div>
      <p className="muted small-text">
        Add an event on any day, including Sunday. A race replaces ordinary
        training; breaks pause all sports. Your running milestones stay
        ceilings.
      </p>
      <div className="action-row">
        <Button
          type="button"
          className="button-secondary"
          onClick={() => {
            setEditing(null);
            setName("");
            setMode(mode === "race" ? null : "race");
          }}
        >
          Add race
        </Button>
        <Button
          type="button"
          className="button-secondary"
          onClick={() => setMode(mode === "pause" ? null : "pause")}
        >
          Plan a break
        </Button>
      </div>
      {mode && (
        <form
          className="screen-stack calendar-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              mode === "race"
                ? {
                    action: "race",
                    ...(editing ? { id: editing } : {}),
                    race: {
                      name: name.trim(),
                      day,
                      startTime: time || null,
                      distanceKm: Number(distance),
                      terrain,
                      elevationGain: elevation ? Number(elevation) : null,
                      expectedMinutes: Number(minutes),
                      priority,
                    },
                  }
                : {
                    action: "pause",
                    pause: { start, end: end || null, reason },
                  },
              mode === "race" ? undefined : start,
            );
          }}
        >
          <h3>
            {mode === "race"
              ? editing
                ? "Edit race"
                : "Schedule a race"
              : "Pause training"}
          </h3>
          {mode === "race" ? (
            <div className="training-form editor-fields">
              <label>
                Event name
                <input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My 10K"
                />
              </label>
              <label>
                Race date
                <input
                  type="date"
                  required
                  min={data.today}
                  max={maxDate}
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </label>
              <label>
                Start time · optional
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>
              <label>
                Course distance · km
                <input
                  type="number"
                  required
                  min="1"
                  max="100"
                  step="0.01"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                />
              </label>
              <label>
                Terrain
                <select
                  value={terrain}
                  onChange={(e) =>
                    setTerrain(e.target.value as "road" | "trail")
                  }
                >
                  <option value="road">Road</option>
                  <option value="trail">Trail</option>
                </select>
              </label>
              <label>
                Elevation gain · m, optional
                <input
                  type="number"
                  min="0"
                  max="15000"
                  step="1"
                  value={elevation}
                  onChange={(e) => setElevation(e.target.value)}
                />
              </label>
              <label>
                Expected course time · min
                <input
                  type="number"
                  required
                  min="5"
                  max="1440"
                  step="1"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </label>
              <label>
                Priority
                <select
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as "goal" | "training")
                  }
                >
                  <option value="goal">
                    Goal race · more preparation time
                  </option>
                  <option value="training">
                    Training race · controlled effort
                  </option>
                </select>
              </label>
            </div>
          ) : (
            <div className="training-form editor-fields">
              <label>
                Reason
                <select
                  value={reason}
                  onChange={(e) =>
                    setReason(e.target.value as TrainingPause["reason"])
                  }
                >
                  <option value="travel">Travel</option>
                  <option value="illness">Illness</option>
                  <option value="injury">Injury</option>
                  <option value="rest">Rest / life</option>
                </select>
              </label>
              <label>
                First day off
                <input
                  type="date"
                  required
                  min={data.today}
                  max={maxDate}
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                Last day off · optional
                <input
                  type="date"
                  min={start}
                  max={maxDate}
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <p className="muted small-text editor-note">
                Leave the end date empty for an indefinite break. Training stays
                paused after the end date until you review your return. Illness
                and injury need individual recovery decisions; the app cannot
                clear you medically.
              </p>
            </div>
          )}
          {mode === "race" && raceImpact.length > 0 && (
            <div
              className="inline-notice small-text"
              aria-label="Weeks affected by this race"
            >
              <strong>Before you save · affected weeks</strong>
              <p>
                {draftRace.priority === "goal" ? "Goal" : "Training"}{" "}
                {draftRace.terrain} event · {raceWindow(draftRace).lead}-day
                preparation window, then {raceWindow(draftRace).recovery} days
                of recovery.{" "}
                {raceImpact.some((w) => w.start === data.monday && w.changed)
                  ? "This changes the current week's calendar too."
                  : "Your current week has no new calendar changes in this preview."}
              </p>
              <div className="race-impact-table">
                <table>
                  <thead>
                    <tr>
                      <th>Week of</th>
                      <th>Before → after</th>
                      <th>Supporting sessions removed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {raceImpact.map((w) => (
                      <tr key={w.start}>
                        <th>
                          {w.start}
                          {w.start === data.monday ? " · this week" : ""}
                        </th>
                        <td>
                          {w.beforeKm.toFixed(1)} → {w.afterKm.toFixed(1)} km
                          {!w.changed ? " · unchanged" : ""}
                        </td>
                        <td>{w.removedSupport}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                Includes race week, preparation and recovery. Saved plans and
                recorded workouts are retained; unsaved weeks use a provisional
                baseline. The effective calendar changes when you select Save
                race & adapt calendar.
              </p>
            </div>
          )}
          {summary && (
            <div className="inline-notice small-text">
              <strong>Week of {summary.start} · preview</strong>
              <p>
                {summary.km.toFixed(1)} km · {summary.runs} running days ·{" "}
                {summary.removed} supporting sessions removed
              </p>
              {summary.notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
              <p>
                Based on the saved week, or a draft using your current baseline.
                Save a reviewed running week separately when needed. No
                automatic mileage catch-up.
              </p>
            </div>
          )}
          <div className="action-row">
            <Button disabled={pending}>
              {pending
                ? "Saving…"
                : mode === "race"
                  ? "Save race & adapt calendar"
                  : "Save break & pause training"}
            </Button>
            <Button
              type="button"
              className="button-secondary"
              onClick={() => setMode(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {message && (
        <p
          className={`inline-notice small-text ${error ? "error-text" : "success-text"}`}
          role={error ? "alert" : "status"}
        >
          {message}
        </p>
      )}
      {(races.length > 0 || pauses.length > 0) && (
        <div className="commitment-list">
          {pauses.map((p) => (
            <article className="commitment-item" key={p.id}>
              <div>
                <strong>
                  {p.reason[0].toUpperCase() + p.reason.slice(1)} break
                </strong>
                <p className="muted small-text">
                  {p.start} →{" "}
                  {p.resumeOn
                    ? `ended ${p.resumeOn}`
                    : (p.end ?? "Until you end it")}{" "}
                  ·{" "}
                  {pauseActive(p, data.today)
                    ? "Paused"
                    : pendingReturn(p, data.today)
                      ? "Return review needed"
                      : p.returnReviewedAt
                        ? "Return phase"
                        : "Upcoming"}
                </p>
              </div>
              <div className="action-row">
                <Button
                  className="button-secondary"
                  onClick={() => onView(p.start)}
                >
                  View week
                </Button>
                {p.start > data.today ? (
                  <Button
                    className="button-secondary"
                    disabled={pending}
                    onClick={() =>
                      void save({ action: "cancel_pause", id: p.id })
                    }
                  >
                    Cancel break
                  </Button>
                ) : (
                  !p.returnReviewedAt && (
                    <>
                      {pauseActive(p, data.today) && (
                        <Button
                          className="button-secondary"
                          disabled={pending}
                          onClick={() =>
                            void save({ action: "resume", id: p.id })
                          }
                        >
                          End break
                        </Button>
                      )}
                      {pendingReturn(p, data.today) && (
                        <Button
                          disabled={pending}
                          onClick={() =>
                            void save(
                              { action: "review_return", id: p.id },
                              data.today,
                            )
                          }
                        >
                          Review return · start gently
                        </Button>
                      )}
                    </>
                  )
                )}
              </div>
              {pendingReturn(p, data.today) && (
                <p className="muted small-text">
                  Sync and log a pain-free, low-fatigue check-in today. This
                  review opens a reduced first week, with up to 5 km per run and
                  no secondary sessions. Longer illness or injury may need a
                  longer return.
                </p>
              )}
              {p.returnReviewedAt && !p.baselineReviewedAt && (
                <div className="screen-stack">
                  <p className="muted small-text">
                    The reduced return phase stays in place until you review a
                    new baseline. After at least seven days and two recorded 5
                    km recovery runs, this saves a 20 km recovery week with no
                    tempo or strides. Previously saved future weeks need review
                    again. It does not restore your old peak. Review illness or
                    injury recovery individually.
                  </p>
                  <Button
                    className="button-secondary"
                    disabled={
                      pending || daysBetween(data.today, p.returnReviewedAt) < 7
                    }
                    onClick={() =>
                      void save(
                        { action: "review_baseline", id: p.id },
                        data.today,
                      )
                    }
                  >
                    Review & save 20 km recovery baseline
                  </Button>
                </div>
              )}
            </article>
          ))}
          {races.map((r) => (
            <article className="commitment-item" key={r.id}>
              <div>
                <strong>{r.name}</strong>
                <p className="muted small-text">
                  {r.day}
                  {r.startTime ? ` · ${r.startTime}` : ""} · {r.distanceKm} km{" "}
                  {r.terrain}
                  {r.elevationGain !== null
                    ? ` · +${r.elevationGain} m`
                    : ""} · {r.priority} · {r.status}
                </p>
              </div>
              <div className="action-row">
                <Button
                  className="button-secondary"
                  onClick={() => onView(r.day)}
                >
                  View race week
                </Button>
                {r.day >= data.today && r.status === "planned" && (
                  <>
                    <Button
                      className="button-secondary"
                      disabled={pending}
                      onClick={() => {
                        setEditing(r.id);
                        setName(r.name);
                        setDay(r.day);
                        setTime(r.startTime ?? "");
                        setDistance(String(r.distanceKm));
                        setTerrain(r.terrain);
                        setElevation(
                          r.elevationGain === null
                            ? ""
                            : String(r.elevationGain),
                        );
                        setMinutes(String(r.expectedMinutes));
                        setPriority(r.priority);
                        setMode("race");
                      }}
                    >
                      Edit race
                    </Button>
                    <Button
                      className="button-secondary"
                      disabled={pending}
                      onClick={() =>
                        void save({ action: "cancel_race", id: r.id })
                      }
                    >
                      Cancel race
                    </Button>
                  </>
                )}
                {r.day <= data.today && r.status === "planned" && (
                  <Button
                    className="button-secondary"
                    disabled={pending}
                    onClick={() =>
                      void save({ action: "complete_race", id: r.id })
                    }
                  >
                    Mark completed
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <details className="supporting-details">
        <summary>How the calendar adapts</summary>
        <p className="muted small-text">
          Goal races get a longer preparation window than training races. The
          calendar removes normal quality and long runs in race week, reduces
          supporting work nearby, and schedules recovery afterwards. Trail
          terrain, longer courses and elevation get more recovery time. These
          are planning heuristics, not proof that you are ready to race. Future
          events inform the AI now; future mileage never counts as completed
          training. Your event name stays local.
        </p>
        <p className="muted small-text">
          A break takes priority over a race. A dated break never restarts
          training automatically. After a return review, recovery runs are
          limited to existing running days and spaced apart. Missed distance is
          never carried into later weeks.
        </p>
      </details>
    </section>
  );
}
