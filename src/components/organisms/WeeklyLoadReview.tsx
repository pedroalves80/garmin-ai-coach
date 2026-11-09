import Link from "next/link";
import type { TrainingDashboardData } from "@/server/training/dashboard";
import type { TrainingPlan } from "@/shared/types/metrics";
import type { WeekSchedule } from "@/shared/types/schedule";
import { reviewPlannedWeek } from "@/shared/planned-load";
export function WeeklyLoadReview({
  plan,
  calendar,
  load,
  development,
}: {
  plan: TrainingPlan;
  calendar: WeekSchedule;
  load: TrainingDashboardData["load"];
  development: TrainingDashboardData["development"];
}) {
  const review = reviewPlannedWeek(calendar, plan, load);
  return (
    <section className="surface">
      <span className="eyebrow">
        RUNNING DEVELOPMENT · {plan.development?.phase ?? "REVIEWED BASELINE"}
      </span>
      <h2>
        {plan.development?.phase === "quality"
          ? "Develop quality at steady volume"
          : plan.development?.phase === "return"
            ? "Return after a planned cutback"
            : plan.cutback
              ? "Make room to recover"
              : "Build from completed training"}
      </h2>
      <p className="muted small-text">
        {plan.development?.reason ??
          "Approved steps remain unchanged until you review a new running week."}
      </p>
      {!development.calibrationFresh && (
        <p className="muted small-text">
          Running targets need review. Quality development is held until current
          evidence is recorded in Settings.
        </p>
      )}
      {review.warnings.length > 0 && (
        <p className="error-text small-text">
          {review.warnings.length} weekly load concern
          {review.warnings.length === 1 ? "" : "s"} to review before
          progressing.
        </p>
      )}
      <details className="supporting-details">
        <summary>Review effort, recovery & target evidence</summary>
        <p>{development.reason}</p>
        <p className="muted small-text">
          Planning estimate: {review.estimatedAu} AU · {review.hardDays}{" "}
          demanding days. Running base/recovery RPE 2, strides/long RPE 3, tempo
          RPE 6, cycling RPE 2–3, Hyrox RPE 7. Undecided classes are included
          conservatively. Actual effort can differ.
        </p>
        {review.warnings.map((warning, i) => (
          <p className="error-text small-text" key={i}>
            {warning}
          </p>
        ))}
        <p className="muted small-text">
          Last completed week: {load.latest.measuredAu} rated AU ·{" "}
          {Math.round(load.latest.coverage * 100)}% of duration rated ·{" "}
          {load.latest.unknownSessions} sessions with missing effort or
          duration. Partial weeks are excluded from progression comparisons.
        </p>
        {load.reasons.map((reason, i) => (
          <p className="muted small-text" key={i}>
            {reason}
          </p>
        ))}
        <p className="muted small-text">
          Load thresholds are conservative review flags, not validated safe
          limits. Skip supporting training when recovery needs it; the one-hour
          ride minimum applies only when riding.
        </p>
        <Link className="text-link" href="/progress">
          Optional effort ratings →
        </Link>
      </details>
    </section>
  );
}
