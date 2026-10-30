"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TrainingPlan } from "@/shared/types/metrics";
import type {
  WeekSchedule,
  WeekPreferences,
  HyroxAttendance,
} from "@/shared/types/schedule";
import { workoutKm } from "@/shared/training-plan";
import { SessionCard } from "../molecules/SessionCard";
import { Button } from "../atoms/Button";

const names = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export function WeeklySchedule({
  plan,
  calendar,
  initialWeek,
  saved,
  today,
  selectedDay,
  onSelect,
}: {
  plan: TrainingPlan;
  calendar: WeekSchedule;
  initialWeek: WeekPreferences;
  saved: boolean;
  today: string;
  selectedDay: number;
  onSelect: (day: number) => void;
}) {
  const router = useRouter(),
    [week, setWeek] = useState(initialWeek),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  const [destination, setDestination] = useState("");
  const day = calendar.days[selectedDay];
  async function save(body: object) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/training/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-coach-request": "local",
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Schedule could not be saved.");
      setMessage("Schedule saved. Running remains the priority.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Schedule could not be saved.",
      );
    } finally {
      setPending(false);
    }
  }
  const destinations = calendar.days.filter(
    (d) =>
      d.dayOffset < 6 &&
      d.dayOffset !== selectedDay &&
      d.day >= today &&
      !d.sessions.some((s) => s.session.sport === "running") &&
      !d.recorded.some((r) => r.sport === "running") &&
      d.recorded.length +
        d.sessions.filter((s) => s.status === "planned").length <
        2,
  );
  const run = day.sessions.find((s) => s.session.sport === "running");
  return (
    <>
      <details className="surface supporting-details">
        <summary>Choose Hyrox attendance & cycling days</summary>
        <form
          className="screen-stack schedule-preferences"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ action: "week", start: plan.start, preferences: week });
          }}
        >
          <p className="muted small-text">
            Choose each class independently for this week. An undecided class
            reserves the later slot; select skipping to use recovery cycling
            instead. Running days are unchanged.
          </p>
          <div className="training-form editor-fields">
            {(["monday", "wednesday", "friday"] as const).map((key) => (
              <label key={key} htmlFor={`hyrox-${key}`}>
                {key[0].toUpperCase() + key.slice(1)} Hyrox
                <select
                  id={`hyrox-${key}`}
                  value={week.hyrox[key]}
                  onChange={(e) =>
                    setWeek({
                      ...week,
                      hyrox: {
                        ...week.hyrox,
                        [key]: e.target.value as HyroxAttendance,
                      },
                    })
                  }
                >
                  <option value="going">Going · 60 min</option>
                  <option value="skipping">Skipping</option>
                  <option value="undecided">Undecided</option>
                </select>
              </label>
            ))}
          </div>
          <fieldset className="cycling-day-choices">
            <legend>Cycling later in the day, when no Hyrox is selected</legend>
            {names.slice(0, 6).map((name, i) => (
              <label key={name} className="checkbox-line">
                <input
                  type="checkbox"
                  checked={week.cyclingDays.includes(i)}
                  onChange={(e) =>
                    setWeek({
                      ...week,
                      cyclingDays: e.target.checked
                        ? [...week.cyclingDays, i]
                        : week.cyclingDays.filter((n) => n !== i),
                    })
                  }
                />
                {name.slice(0, 3)}
              </label>
            ))}
          </fieldset>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={week.cycleWhenSkippingHyrox}
              onChange={(e) =>
                setWeek({ ...week, cycleWhenSkippingHyrox: e.target.checked })
              }
            />{" "}
            Recovery cycling when I skip Hyrox
          </label>
          <div>
            <Button disabled={pending}>Save this week’s attendance</Button>
          </div>
        </form>
      </details>
      <div
        className="week-strip mixed-week-strip"
        role="group"
        aria-label="Choose a workout day"
      >
        {calendar.days.map((d) => {
          const run = d.sessions.find(
            (s) => s.session.sport === "running",
          )?.session;
          const secondary = d.sessions.find(
            (s) => s.session.sport !== "running",
          )?.session;
          return (
            <button
              key={d.day}
              type="button"
              aria-pressed={selectedDay === d.dayOffset}
              aria-label={`${names[d.dayOffset]} · ${run?.sport === "running" ? `${workoutKm(run.workout, plan.easyPace).toFixed(1)} km run` : "no run"}${secondary ? ` + ${secondary.sport}` : ""}`}
              onClick={() => {
                onSelect(d.dayOffset);
                setDestination("");
              }}
            >
              <span>{names[d.dayOffset].slice(0, 3)}</span>
              <strong>{Number(d.day.slice(-2))}</strong>
              <small>
                {run?.sport === "running"
                  ? `${workoutKm(run.workout, plan.easyPace).toFixed(1)}k`
                  : d.dayOffset === 6
                    ? "Rest"
                    : "—"}
              </small>
              <small className="secondary-day-label">
                {secondary?.sport === "hyrox"
                  ? `Hyrox${secondary.attendance === "undecided" ? "?" : ""}`
                  : secondary?.sport === "cycling"
                    ? "Cycle"
                    : ""}
              </small>
              <span className={`day-dot ${run ? "has-run" : ""}`} />
            </button>
          );
        })}
      </div>
      <section
        className="surface selected-workout"
        aria-labelledby="day-schedule-heading"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              {day.day} · {saved ? "Reviewed week" : "Draft preview"}
            </span>
            <h2 id="day-schedule-heading">
              {names[selectedDay]}
              {selectedDay === 6 ? " · Rest" : ""}
            </h2>
          </div>
          <span className="muted small-text">
            {day.sessions.length} / 2 sessions
          </span>
        </div>
        <div className="day-sessions">
          {day.sessions.map((entry, i) => (
            <SessionCard
              key={`${day.day}-${entry.session.sport}-${i}`}
              entry={entry}
              easyPace={plan.easyPace}
            />
          ))}
        </div>
        {!day.sessions.length && (
          <p className="muted">
            {selectedDay === 6
              ? "Complete rest. No running, cycling or Hyrox scheduled."
              : "No workout scheduled. Leave room for recovery."}
          </p>
        )}
        {day.warnings.map((warning, i) => (
          <p className="error-text small-text" key={i}>
            {warning}
          </p>
        ))}
        {!!day.recorded.length && (
          <details className="supporting-details">
            <summary>Recorded activities · {day.recorded.length}</summary>
            {day.recorded.map((a, i) => (
              <p key={i} className="muted small-text">
                {a.sport} · {a.minutes} min
                {a.sport === "running" ? ` · ${a.km.toFixed(1)} km` : ""}
              </p>
            ))}
          </details>
        )}
        {saved &&
          run?.status === "planned" &&
          day.day >= today &&
          destinations.length > 0 && (
            <details className="supporting-details">
              <summary>Move this run to another day</summary>
              <form
                className="move-run-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (destination)
                    void save({
                      action: "move",
                      start: plan.start,
                      from: selectedDay,
                      to: Number(destination),
                    });
                }}
              >
                <label htmlFor="run-destination">
                  Destination · same week
                  <select
                    id="run-destination"
                    required
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                  >
                    <option value="">Choose a free running day</option>
                    {destinations.map((d) => (
                      <option key={d.day} value={d.dayOffset}>
                        {names[d.dayOffset]} · {d.day}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted small-text">
                  Moves the whole run and preserves weekly distance. Weekday
                  lunch must fit 2 hours. Consider recovery around Hyrox and the
                  long run.
                </p>
                <Button disabled={pending || destination === ""}>
                  Move run
                </Button>
              </form>
            </details>
          )}
      </section>
      {saved &&
        day.day >= today &&
        day.dayOffset < 6 &&
        day.sessions.some(
          (s) => s.session.sport !== "running" && s.status === "planned",
        ) && (
          <div className="surface">
            <p className="muted small-text">
              Supporting sessions are optional. Skip the later session when
              recovery or the next key run needs priority. A prescribed ride
              remains at least one hour.
            </p>
            <Button
              className="button-secondary"
              disabled={pending}
              onClick={() =>
                void save({
                  action: "skip_secondary",
                  start: plan.start,
                  dayOffset: selectedDay,
                })
              }
            >
              Skip later session · keep the run
            </Button>
          </div>
        )}
      {message && (
        <p className="inline-notice small-text" role="status">
          {message}
        </p>
      )}
      <p className="muted small-text">
        Running leads the week. Cycling supports it and can replace Hyrox.
        Sunday always rests. The milestone stages are ceilings; increases still
        require training and recovery review.
      </p>
    </>
  );
}
