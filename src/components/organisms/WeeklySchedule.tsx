"use client";
import { RacePaceCard } from "../molecules/RacePaceCard";
import { RegisteredRaceNotice } from "../molecules/RegisteredRaceNotice";
import type { RacePaceAdvice } from "@/shared/types/race-pacing";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TrainingPlan } from "@/shared/types/metrics";
import type {
  WeekSchedule,
  WeekPreferences,
  HyroxAttendance,
} from "@/shared/types/schedule";
import { workoutMileageKm as workoutKm } from "@/shared/mileage";
import { SessionCard } from "../molecules/SessionCard";
import { ScheduleAdjustments } from "./ScheduleAdjustments";
import { Button } from "../atoms/Button";

const slotLabels = { morning: "Morning", lunch: "Lunch", later: "Later" };
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
  racePaceAdvice = [],
}: {
  plan: TrainingPlan;
  calendar: WeekSchedule;
  initialWeek: WeekPreferences;
  saved: boolean;
  today: string;
  selectedDay: number;
  onSelect: (day: number) => void;
  racePaceAdvice?: RacePaceAdvice[];
}) {
  const router = useRouter(),
    [week, setWeek] = useState(initialWeek),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
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
          const racePrescribed = d.sessions.some(
            (s) =>
              s.status !== "blocked" &&
              s.session.sport === "running" &&
              s.session.workout.race?.id === d.race?.id &&
              !!d.race,
          );
          return (
            <button
              key={d.day}
              type="button"
              aria-pressed={selectedDay === d.dayOffset}
              aria-label={`${names[d.dayOffset]} · ${d.race ? `${d.race.name} · ${d.race.distanceKm} km race${!racePrescribed ? " · Not prescribed, needs review" : ""}` : run?.sport === "running" ? `${workoutKm(run.workout, plan.easyPace).toFixed(1)} km run` : "no run"}${secondary ? ` + ${secondary.sport}` : ""}${d.unavailableSlots?.length ? ` · Unavailable: ${d.unavailableSlots.map((slot) => slotLabels[slot]).join(", ")}` : ""}`}
              onClick={() => onSelect(d.dayOffset)}
            >
              <span>{names[d.dayOffset].slice(0, 3)}</span>
              <strong>{Number(d.day.slice(-2))}</strong>
              <small>
                {d.race
                  ? `${d.race.distanceKm}k race`
                  : run?.sport === "running"
                    ? `${workoutKm(run.workout, plan.easyPace).toFixed(1)}k`
                    : d.dayOffset === 6
                      ? "Rest"
                      : "—"}
              </small>
              <small className="secondary-day-label">
                {d.race && !racePrescribed
                  ? "Needs review"
                  : secondary?.sport === "hyrox"
                    ? `Hyrox${secondary.attendance === "undecided" ? "?" : ""}`
                    : secondary?.sport === "cycling"
                      ? "Cycle"
                      : ""}
              </small>
              {!!d.unavailableSlots?.length && (
                <small className="unavailable-day-label">Unavailable</small>
              )}
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
              {day.race && day.rule?.phase === "race"
                ? " · Race"
                : day.rule
                  ? ` · ${day.rule.phase.replaceAll("_", " ")}`
                  : selectedDay === 6
                    ? " · Rest"
                    : ""}
            </h2>
          </div>
          <span className="muted small-text">
            {day.sessions.length} / 2 sessions
          </span>
        </div>
        <RegisteredRaceNotice day={day} />
        {day.race && racePaceAdvice.find((a) => a.raceId === day.race!.id) && (
          <RacePaceCard
            advice={racePaceAdvice.find((a) => a.raceId === day.race!.id)!}
          />
        )}
        {!!day.unavailableSlots?.length && (
          <p className="inline-notice small-text">
            Unavailable ·{" "}
            {day.unavailableSlots.length === 3
              ? "Whole day"
              : day.unavailableSlots.map((slot) => slotLabels[slot]).join(", ")}
          </p>
        )}
        {day.rule?.notes.map((note) => (
          <p className="inline-notice small-text" key={note}>
            {note}
          </p>
        ))}
        <div className="day-sessions">
          {day.sessions.map((entry, i) => (
            <SessionCard
              key={`${day.day}-${entry.session.sport}-${i}`}
              entry={entry}
              easyPace={plan.easyPace}
              unconfirmed={saved && day.day < today}
            />
          ))}
        </div>
        {!day.sessions.length && (
          <p className="muted">
            {day.race
              ? "Registered event retained above. No race workout is prescribed until the conflict is reviewed."
              : day.unavailableSlots?.length
                ? "No workouts scheduled. Your availability blocks are reflected here."
                : selectedDay === 6
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
        {saved && <ScheduleAdjustments day={day.day} />}
      </section>
      {message && (
        <p className="inline-notice small-text" role="status">
          {message}
        </p>
      )}
      <p className="muted small-text">
        Running leads the week. Cycling supports it and can replace Hyrox.
        Sunday rests unless you explicitly schedule a race. The milestone stages
        are ceilings; increases still require training and recovery review.
      </p>
    </>
  );
}
