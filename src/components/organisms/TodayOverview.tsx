import Link from "next/link";
import type { DashboardData } from "@/server/dashboard/data";
import type { TrainingDashboardData } from "@/server/training/dashboard";
import { MetricCard } from "@/components/molecules/MetricCard";
import { Icon } from "@/components/atoms/Icon";
import { WeeklyPlanReview } from "./WeeklyPlanReview";
import { SessionCard } from "../molecules/SessionCard";
import { DailyCoachSummary } from "./DailyCoachSummary";
import { RecoveryCheckIn } from "./RecoveryCheckIn";
import { ScheduleAdjustments } from "./ScheduleAdjustments";
import {
  formatWorkoutDistance,
  defaultEasyPace,
  isDistanceWorkout,
} from "@/shared/training-plan";

export function TodayOverview({
  data,
  training,
}: {
  data: DashboardData;
  training: TrainingDashboardData;
}) {
  const recorded = training.todayRunning.runs > 0,
    workout = training.todayWorkout,
    rest = !!training.todaySessions && !workout;
  const unavailableSlots = training.todaySessions?.unavailableSlots ?? [];
  const unavailable = unavailableSlots.length > 0;
  const unavailableText =
    unavailableSlots.length === 3 ? "all day" : unavailableSlots.join(", ");
  const health = data.health;
  const target = training.plannedKm;
  return (
    <div className="screen-stack">
      <WeeklyPlanReview planning={training.weeklyRecommendation} compact />
      <section className="today-hero" aria-labelledby="today-run-heading">
        <div className="hero-content">
          <span className="hero-label">
            <span className="hero-dot" />
            {recorded
              ? "RUN RECORDED TODAY"
              : workout
                ? "ON YOUR SCHEDULE"
                : unavailable
                  ? "TRAINING WINDOWS UNAVAILABLE"
                  : rest
                    ? "REST FROM RUNNING"
                    : "YOUR NEXT WEEK"}
          </span>
          <h2 id="today-run-heading">
            {recorded
              ? `${training.todayRunning.km.toFixed(1)} km, logged.`
              : workout
                ? workout.title
                : unavailable
                  ? "Your availability, respected."
                  : rest
                    ? "A day for recovery."
                    : "A little planning. A better week."}
          </h2>
          <p>
            {recorded
              ? `${Math.round(training.todayRunning.minutes)} minutes of running synced today. Take a moment to check in with your recovery.`
              : workout
                ? `Your saved workout is ready. ${formatWorkoutDistance(workout, training.currentPlan?.easyPace ?? defaultEasyPace)}, with the steps laid out for Garmin.`
                : unavailable
                  ? `Unavailable ${unavailableText}. Workouts in those windows are excluded from today’s schedule. Review your availability to make room again.`
                  : rest
                    ? "No run is scheduled today. Check in with your recovery and follow your other planned training."
                    : "Review your starting week, then build from the training you actually complete."}
          </p>
          <Link
            className="button hero-button"
            href={recorded ? "/progress" : "/plan"}
          >
            {recorded
              ? "See your progress"
              : workout
                ? "Open your workout"
                : rest
                  ? "View your week"
                  : "Plan your week"}
            <Icon name="arrow" />
          </Link>
        </div>
        <div className="hero-art" aria-hidden="true">
          <svg viewBox="0 0 240 200" fill="none">
            <path
              d="M10 185c36-18 12-70 61-73s90 33 84-13-68-18-58-54 94-28 127-39"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="5 7"
            />
            <circle cx="10" cy="185" r="7" fill="currentColor" />
            <circle cx="224" cy="6" r="6" fill="currentColor" />
            <path
              d="m85 110 25-18 19 7 17-28m-28 29-10 23 20 19m-21-17-27 8m44-69 13 7-7 14-14-6 8-15Z"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </section>
      {training.todaySessions && (
        <section className="surface">
          <div className="section-heading">
            <h2>Your sessions today</h2>
            <Link className="text-link" href="/plan">
              Your week <Icon name="arrow" />
            </Link>
          </div>
          {unavailable && (
            <p className="inline-notice small-text">
              Unavailable · {unavailableText}
            </p>
          )}
          {training.todaySessions.rule?.notes.map((note) => (
            <p className="inline-notice small-text" key={note}>
              {note}
            </p>
          ))}
          <div className="day-sessions">
            {training.todaySessions.sessions.map((entry, i) => (
              <SessionCard
                compact
                key={i}
                entry={entry}
                easyPace={training.currentPlan?.easyPace}
              />
            ))}
          </div>
          {!training.todaySessions.sessions.length && (
            <p className="muted">
              {unavailable
                ? "No workouts scheduled. Your availability blocks are reflected here."
                : "No workouts prescribed. Sunday rests unless you explicitly schedule a race."}
            </p>
          )}
          {training.currentPlan && <ScheduleAdjustments day={training.today} />}
          {training.todaySessions.warnings.map((warning, i) => (
            <p className="error-text small-text" key={i}>
              {warning}
            </p>
          ))}
        </section>
      )}
      <DailyCoachSummary today={training.today} />
      <div className="metric-grid">
        <MetricCard
          label="Running this week"
          value={training.synced ? `${data.runningKm.toFixed(1)} km` : "—"}
          detail="Since Monday"
        />
        <MetricCard
          label="Runs recorded"
          value={training.synced ? String(data.runningCount) : "—"}
          detail="This week"
        />
        <MetricCard
          label="Training time"
          value={
            training.synced ? `${Math.round(data.trainingMinutes)} min` : "—"
          }
          detail="Running + other sports"
        />
      </div>
      <div className="today-columns">
        <div className="screen-stack">
          <section className="surface weekly-snapshot">
            <div className="section-heading">
              <h2>Your week, at a glance</h2>
              <Link className="text-link" href="/plan">
                View plan <Icon name="arrow" />
              </Link>
            </div>
            <div className="weekly-distance">
              <strong>
                {training.synced ? data.runningKm.toFixed(1) : "—"}
                <span> km</span>
              </strong>
              <span className="muted">
                {target === null
                  ? "No saved distance target"
                  : `of ${training.currentPlan?.workouts.every(isDistanceWorkout) ? "" : "≈"}${target.toFixed(1)} km planned`}
              </span>
            </div>
            {target !== null && training.synced && (
              <meter
                className="week-meter"
                min={0}
                max={Math.max(target, data.runningKm, 1)}
                value={data.runningKm}
                aria-label="Running distance toward the reviewed week"
              />
            )}
            <p className="muted small-text">
              {target === null
                ? "Your plan is still a preview. Save a reviewed week to track it here."
                : "Distance recorded so far. Workout intensity is reviewed separately."}
            </p>
          </section>
          <RecoveryCheckIn data={training} />
        </div>
        <section className="surface recovery-snapshot">
          <div className="section-heading">
            <h2>Recovery snapshot</h2>
            <Icon name="heart" />
          </div>
          <p className="muted small-text">
            {health
              ? `Latest Garmin data · ${health.day}`
              : "Sync Garmin to see your recovery data."}
          </p>
          <dl className="recovery-values">
            <div>
              <dt>Sleep</dt>
              <dd>
                {health?.sleepSeconds == null
                  ? "—"
                  : `${(health.sleepSeconds / 3600).toFixed(1)} h`}
              </dd>
            </div>
            <div>
              <dt>Resting heart rate</dt>
              <dd>
                {health?.restingHeartRate == null
                  ? "—"
                  : `${health.restingHeartRate} bpm`}
              </dd>
            </div>
            <div>
              <dt>Body Battery</dt>
              <dd>{health?.bodyBattery ?? "—"}</dd>
            </div>
          </dl>
          <Link className="text-link" href="/coach">
            Talk through your training <Icon name="arrow" />
          </Link>
        </section>
      </div>
    </div>
  );
}
