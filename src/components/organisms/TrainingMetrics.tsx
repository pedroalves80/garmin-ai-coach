import type { TrainingDashboardData } from "@/server/training/dashboard";
import { MetricCard } from "@/components/molecules/MetricCard";
import { StatusBadge } from "@/components/atoms/StatusBadge";
import { formatPace, isDistanceWorkout } from "@/shared/training-plan";

export function TrainingMetrics({ data }: { data: TrainingDashboardData }) {
  const current = data.weeks.at(-1)!;
  const comparison = data.comparison;
  return (
    <section
      id="progress"
      className="training-section"
      aria-labelledby="progress-heading"
    >
      <div className="section-heading">
        <h2 id="progress-heading">Your training trends</h2>
        <StatusBadge>This week is partial</StatusBadge>
      </div>
      <div className="metric-grid">
        <MetricCard
          label="4 completed weeks"
          value={data.synced ? `${data.averageKm.toFixed(1)} km` : "—"}
          detail="Average weekly running distance"
        />
        <MetricCard
          label="Last full week"
          value={
            data.synced && data.weekChangePercent !== null
              ? `${data.weekChangePercent > 0 ? "+" : ""}${data.weekChangePercent.toFixed(0)}%`
              : "—"
          }
          detail="Versus the previous full week"
        />
        <MetricCard
          label="Current plan"
          value={
            data.plannedKm === null
              ? "Draft"
              : `${data.currentPlan?.workouts.every(isDistanceWorkout) ? "" : "≈"}${data.plannedKm.toFixed(1)} km`
          }
          detail={
            data.plannedKm === null
              ? "Review a week in Plan"
              : "Sum of all workout steps"
          }
        />
      </div>
      <div className="dashboard-grid">
        <section className="surface" aria-labelledby="volume-heading">
          <h3 id="volume-heading">Your weekly running</h3>
          {data.weeks.map((week) => (
            <div className="trend-row" key={week.start}>
              <div className="step-top">
                <span>
                  {week.start}
                  {week.partial ? " · so far" : ""}
                </span>
                <strong>
                  {week.runningKm.toFixed(1)} km ·{" "}
                  {Math.round(week.runningMinutes)} min
                </strong>
              </div>
              <meter
                min={0}
                max={Math.max(1, ...data.weeks.map((w) => w.runningKm))}
                value={week.runningKm}
                aria-label={`Running distance for week of ${week.start}`}
              />
            </div>
          ))}
          <p className="muted small-text">
            Current-week totals are not compared with a full week. Zero means no
            runs recorded in synced data.
          </p>
        </section>
        <section className="surface" aria-labelledby="sports-heading">
          <h3 id="sports-heading">This week by sport</h3>
          <dl className="health-values">
            <div>
              <dt>Running</dt>
              <dd>
                {current.runningKm.toFixed(1)} km ·{" "}
                {Math.round(current.runningMinutes)} min
              </dd>
            </div>
            <div>
              <dt>Cycling</dt>
              <dd>{Math.round(current.cyclingMinutes)} min</dd>
            </div>
            <div>
              <dt>Hyrox</dt>
              <dd>{Math.round(current.hyroxMinutes)} min</dd>
            </div>
            <div>
              <dt>Other training</dt>
              <dd>{Math.round(current.otherMinutes)} min</dd>
            </div>
            <div>
              <dt>Wellness · separate</dt>
              <dd>{Math.round(current.wellnessMinutes)} min</dd>
            </div>
          </dl>
          <details className="supporting-details">
            <summary>How training time is grouped</summary>
            <p className="muted small-text">
              Hyrox uses the activity type or a HYROX label. Meditation,
              breathing and yoga are kept out of training-time totals. Minutes
              describe volume, not intensity or a physiological load score.
            </p>
          </details>
        </section>
      </div>
      <section className="surface comparison-panel">
        <h3>Similar-run pace / HR observations</h3>
        {comparison.secondsPerKmChange === null ? (
          <p className="muted">
            {comparison.pairs} matched pairs found; at least 3 are needed before
            showing a trend.
          </p>
        ) : (
          <>
            <p className="comparison-value">
              {formatPace(comparison.beforePace!)} →{" "}
              {formatPace(comparison.afterPace!)}/km
            </p>
            <p className="muted">
              Median paired change:{" "}
              {Math.abs(comparison.secondsPerKmChange).toFixed(0)} sec/km{" "}
              {comparison.secondsPerKmChange < 0 ? "faster" : "slower"} ·{" "}
              {comparison.pairs} independent pairs.
            </p>
          </>
        )}
        <details className="supporting-details">
          <summary>How similar runs are compared</summary>
          <p className="muted small-text">
            Last 28 days versus the preceding 28. Outdoor road runs only,
            average HR 135–150 bpm and within 3 bpm between runs, distance
            within 10%, starting area within 250 m and ascent per km within 5 m.
            Temperature difference is limited to 5°C where present. Starting
            area is not proof of the same route; wind, effort and stops are not
            controlled.{" "}
            {comparison.weatherMissing
              ? "Some temperature data is missing. "
              : ""}
            This is an observation, not a fixed-HR fitness test.
          </p>
        </details>
      </section>
      <section
        className="surface comparison-panel"
        aria-labelledby="progression-heading"
      >
        <div className="section-heading">
          <h3 id="progression-heading">Volume review</h3>
          <StatusBadge
            tone={
              data.progression.decision === "reduce"
                ? "warning"
                : data.progression.decision === "increase"
                  ? "success"
                  : "info"
            }
          >
            {data.progression.decision.toUpperCase()}
          </StatusBadge>
        </div>
        {data.progression.reasons.map((reason) => (
          <p key={reason}>{reason}</p>
        ))}
        {data.progression.suggestedKm !== null && (
          <p className="muted">
            Review reference: ≈{data.progression.suggestedKm.toFixed(1)} km. No
            plan changes are applied automatically.
          </p>
        )}
        <p className="muted small-text">
          These are conservative app rules, not a validated injury prediction.
          Weekly totals alone cannot establish readiness.
        </p>
      </section>
      {!!data.completion.length && (
        <details className="surface comparison-panel supporting-details">
          <summary>Saved plan versus recorded running</summary>
          <ul className="activity-list">
            {data.completion.map((item) => (
              <li key={item.day}>
                <div className="step-top">
                  <strong>
                    {item.day} · {item.title}
                  </strong>
                  <StatusBadge>{item.status}</StatusBadge>
                </div>
                <p className="muted">
                  {item.recordedKm.toFixed(1)} / ≈{item.plannedKm.toFixed(1)} km
                </p>
              </li>
            ))}
          </ul>
          <p className="muted small-text">
            Matched by local calendar day. “Distance met” means at least 90% of
            estimated distance, not confirmation that pace or HR targets were
            followed.
          </p>
        </details>
      )}
    </section>
  );
}
