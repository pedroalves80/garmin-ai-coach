import { z } from "zod";
import type { TrainingWeek } from "../../shared/types/metrics";
import type {
  SupportingWorkload,
  WeeklySelectionPolicy,
} from "../../shared/types/weekly-planning";

// One machine-checkable reason must support a discretionary AI reduction.
export const weeklyOutput = z
  .object({
    choice: z.enum(["recommended", "consolidate", "recovery"]),
    reason: z.enum([
      "local_recommendation",
      "recovery_caution",
      "reported_recovery",
      "supporting_increase",
      "combined_load",
      "planned_load",
      "incomplete_running",
      "stale_data",
      "calendar_restriction",
    ]),
    summary: z.string().min(1).max(700),
    observations: z.array(z.string().min(1).max(300)).min(1).max(4),
  })
  .strict();
export function permittedWeeklyChoice(
  review: z.infer<typeof weeklyOutput>,
  policy: WeeklySelectionPolicy,
) {
  return review.choice === "recommended"
    ? review.reason === "local_recommendation"
    : policy.reductionEvidence.some((e) => e.code === review.reason);
}

// Repeated supporting work is the baseline, not a new reason to hold running.
// Empty weeks are unknown coverage, rather than a zero workload reference.
export function supportingWorkload(
  weeks: TrainingWeek[],
  referenceStart: string,
): SupportingWorkload {
  const minutes = (w: TrainingWeek) =>
    w.cyclingMinutes + w.hyroxMinutes + w.otherMinutes;
  const recent = weeks.find((w) => w.start === referenceStart);
  const prior = weeks.filter(
    (w) =>
      w.start < referenceStart &&
      !w.partial &&
      w.runningMinutes + minutes(w) > 0,
  );
  const baselineMinutes = prior.length
    ? prior.reduce((sum, w) => sum + minutes(w), 0) / prior.length
    : null;
  const recentMinutes = recent ? minutes(recent) : 0;
  const change =
    baselineMinutes !== null && baselineMinutes > 0 && recent
      ? recentMinutes / baselineMinutes - 1
      : null;
  return {
    recentMinutes,
    baselineMinutes,
    baselineWeeks: prior.length,
    change,
    increased: change !== null && change > 0.25,
  };
}
