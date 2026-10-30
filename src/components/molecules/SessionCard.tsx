"use client";
import { useState } from "react";
import type { SessionState } from "@/shared/types/schedule";
import { formatWorkoutDistance, defaultEasyPace } from "@/shared/training-plan";
import {
  powerRange,
  cyclingMinutes,
  cyclingWorkoutText,
} from "@/shared/weekly-schedule";
import { PlanSteps } from "./PlanSteps";
import { CopyWorkoutButton } from "./CopyWorkoutButton";
import { StatusBadge } from "../atoms/StatusBadge";
import { Button } from "../atoms/Button";

export function SessionCard({
  entry,
  easyPace = defaultEasyPace,
  compact = false,
}: {
  entry: SessionState;
  easyPace?: number;
  compact?: boolean;
}) {
  const { session, status } = entry;
  const [message, setMessage] = useState("");
  const title =
    session.sport === "hyrox" ? "Hyrox class" : session.workout.title;
  return (
    <article className={`session-card session-${session.sport}`}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {session.slot === "lunch" ? "First session" : "Later session"} ·{" "}
            {session.sport}
          </span>
          <h3>{title}</h3>
        </div>
        <StatusBadge tone={status === "recorded" ? "success" : "info"}>
          {status === "planned" &&
          session.sport === "hyrox" &&
          session.attendance === "undecided"
            ? "Tentative"
            : status}
        </StatusBadge>
      </div>
      {status === "blocked" ? (
        <p className="error-text">
          Daily session limit reached. Review your recorded activities before
          doing this workout.
        </p>
      ) : compact ? (
        <p className="muted small-text">
          {session.sport === "running"
            ? `${formatWorkoutDistance(session.workout, easyPace)} total · Steps in Plan`
            : session.sport === "cycling"
              ? `${cyclingMinutes(session.workout)} min · ${powerRange(session.workout.ftpWatts, session.workout.steps[1].minPercent, session.workout.steps[1].maxPercent).min}–${powerRange(session.workout.ftpWatts, session.workout.steps[1].minPercent, session.workout.steps[1].maxPercent).max} W main set · Steps in Plan`
              : `60 min · ${session.attendance === "undecided" ? "Attendance undecided" : "Attendance selected"}`}
        </p>
      ) : session.sport === "running" ? (
        <>
          <p className="muted small-text">
            {formatWorkoutDistance(session.workout, easyPace)} total · Distance
            steps for Garmin
          </p>
          <PlanSteps steps={session.workout.steps} />
          <CopyWorkoutButton workout={session.workout} />
        </>
      ) : session.sport === "cycling" ? (
        <>
          <p className="muted small-text">
            {cyclingMinutes(session.workout)} min · FTP{" "}
            {session.workout.ftpWatts} W · Zwift power
          </p>
          <ol className="plan-steps">
            {session.workout.steps.map((step, i) => {
              const power = powerRange(
                session.workout.ftpWatts,
                step.minPercent,
                step.maxPercent,
              );
              return (
                <li key={i}>
                  <div className="step-top">
                    <strong>{step.name}</strong>
                    <span>{step.minutes} min</span>
                  </div>
                  <small>
                    {power.min}–{power.max} W · {step.minPercent}–
                    {step.maxPercent}% FTP
                  </small>
                </li>
              );
            })}
          </ol>
          <Button
            className="button-secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  cyclingWorkoutText(session.workout),
                );
                setMessage("Zwift steps copied.");
              } catch {
                setMessage(
                  "Clipboard unavailable. Copy the steps above manually.",
                );
              }
            }}
          >
            Copy Zwift steps
          </Button>
          {message && (
            <p className="small-text" role="status">
              {message}
            </p>
          )}
        </>
      ) : (
        <>
          <p>
            60 min class ·{" "}
            {session.attendance === "undecided"
              ? "Confirm attendance in Plan before committing to this session."
              : "Attendance selected for this week."}
          </p>
          <p className="muted small-text">
            Technique first. Scale leg work if it compromises your next run; the
            coach can suggest recovery cycling or removing this session.
          </p>
        </>
      )}
      {status === "recorded" && (
        <p className="success-text small-text">
          Activity recorded in Garmin. Steps show the prescription, not a
          confirmation that every target was met. Do not repeat the workout.
        </p>
      )}
    </article>
  );
}
