"use client";

import { useEffect, useId, useRef } from "react";
import type {
  ScheduleEditPreview,
  TrainingSlot,
} from "@/shared/types/rescheduling";
import type { SessionState } from "@/shared/types/schedule";
import type { PlanStep } from "@/shared/types/metrics";
import {
  defaultEasyPace,
  formatWorkoutDistance,
  targetText,
} from "@/shared/training-plan";
import { cyclingMinutes, powerRange } from "@/shared/weekly-schedule";
import { TrailGuidance } from "./TrailGuidance";
import { Button } from "../atoms/Button";
import { dateLabel, sessionLabel, slotLabels } from "./schedule-change-labels";

function targets(steps: PlanStep[]): string[] {
  return steps.flatMap((step) =>
    step.kind === "repeat" ? targets(step.steps) : [targetText(step.target)],
  );
}

function SessionSummary({
  entries,
  unavailable,
  easyPace,
}: {
  entries: SessionState[];
  unavailable: TrainingSlot[];
  easyPace: number;
}) {
  return (
    <>
      {entries.length ? (
        <ul className="adjustment-sessions">
          {entries.map((entry, index) => {
            const { session } = entry;
            return (
              <li key={session.id ?? index}>
                <strong>{sessionLabel(entry)}</strong>
                <span>
                  {session.sport === "running"
                    ? `${formatWorkoutDistance(session.workout, easyPace)} · ${[...new Set(targets(session.workout.steps))].join("; ")}`
                    : session.sport === "cycling"
                      ? `${cyclingMinutes(session.workout)} min · ${session.workout.steps
                          .map((step) => {
                            const power = powerRange(
                              session.workout.ftpWatts,
                              step.minPercent,
                              step.maxPercent,
                            );
                            return `${step.name}: ${power.min}–${power.max} W`;
                          })
                          .join("; ")}`
                      : `${session.minutes} min · ${session.attendance}`}
                </span>
                {session.sport === "running" && (
                  <TrailGuidance workout={session.workout} />
                )}
                {entry.status !== "planned" && (
                  <span>
                    {entry.status === "recorded" ? "Recorded" : "Blocked"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small-text">No workouts scheduled.</p>
      )}
      <p className="muted small-text">
        {unavailable.length === 3
          ? "Unavailable all day"
          : unavailable.length
            ? `Unavailable: ${unavailable.map((slot) => slotLabels[slot]).join(", ")}`
            : "No availability blocks"}
      </p>
    </>
  );
}

export function ScheduleChangePreview({
  preview,
  easyPaces,
  applying,
  onApply,
  onCancel,
}: {
  preview: ScheduleEditPreview;
  easyPaces: Record<string, number>;
  applying: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const previewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    previewHeading.current?.focus();
  }, [preview]);
  return (
    <section className="adjustment-preview" aria-labelledby={`${id}-preview`}>
      <h4 ref={previewHeading} tabIndex={-1} id={`${id}-preview`}>
        Review change
      </h4>
      <p>{preview.summary}</p>
      <p className="muted small-text">
        Nothing is saved until you select Apply change.
      </p>
      {preview.days.map((affected) => (
        <article className="adjustment-day" key={affected.day}>
          <h4>{dateLabel(affected.day)}</h4>
          <div className="adjustment-comparison">
            {(["before", "after"] as const).map((side) => (
              <div key={side}>
                <span className="eyebrow">{side}</span>
                <SessionSummary
                  entries={affected[side]}
                  unavailable={
                    side === "before"
                      ? affected.beforeUnavailable
                      : affected.afterUnavailable
                  }
                  easyPace={easyPaces[affected.day] ?? defaultEasyPace}
                />
              </div>
            ))}
          </div>
        </article>
      ))}
      {!!preview.weeks.length && (
        <div className="adjustment-week-totals">
          <h4>Weekly running distance</h4>
          <ul>
            {preview.weeks.map((week) => {
              const difference = week.afterKm - week.beforeKm;
              return (
                <li key={week.start}>
                  Week of {dateLabel(week.start)}:{" "}
                  <strong>
                    {week.beforeKm.toFixed(1)} → {week.afterKm.toFixed(1)} km
                  </strong>{" "}
                  <span className="muted">
                    (
                    {Math.abs(difference) < 0.05
                      ? "unchanged"
                      : `${difference > 0 ? "+" : ""}${difference.toFixed(1)} km`}
                    )
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {!!preview.warnings.length && (
        <div className="inline-notice small-text">
          <strong>Review before applying</strong>
          <ul>
            {preview.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="adjustment-actions">
        <Button type="button" disabled={applying} onClick={onApply}>
          {applying ? "Applying…" : "Apply change"}
        </Button>
        <Button
          type="button"
          className="button-secondary"
          disabled={applying}
          onClick={onCancel}
        >
          Cancel preview
        </Button>
      </div>
    </section>
  );
}
