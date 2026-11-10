import { applyCommitments, raceWindow } from "./commitment-calendar";
import { dayOffsetDate } from "./weekly-schedule";
import { workoutKm } from "./training-plan";
import { weekMonday } from "./week-view";
import type { RaceEvent, Commitments } from "./types/commitments";
import type { RunningTargets } from "./types/athlete";
import type { TrainingPlan } from "./types/metrics";
import type { WeekSchedule } from "./types/schedule";
import { applyAvailability } from "./schedule-editing";
import type { AvailabilityBlock } from "./types/rescheduling";
export function raceImpactWeeks(
  race: RaceEvent,
  old: RaceEvent | undefined,
  today: string,
) {
  const starts = new Set<string>();
  for (const r of old ? [race, old] : [race]) {
    const window = raceWindow(r),
      prep = dayOffsetDate(r.day, -window.lead);
    const first =
      weekMonday(prep) < weekMonday(r.day)
        ? weekMonday(prep)
        : weekMonday(r.day);
    const last = weekMonday(dayOffsetDate(r.day, window.recovery));
    for (let w = first; w <= last; w = dayOffsetDate(w, 7))
      if (w >= weekMonday(today)) starts.add(w);
  }
  return [...starts].sort();
}
export function compareRaceImpact(input: {
  plan: TrainingPlan;
  baseline: WeekSchedule;
  before: Commitments;
  after: Commitments;
  targets: RunningTargets;
  options: Parameters<typeof applyCommitments>[4];
  availability: AvailabilityBlock[];
}) {
  const { plan, baseline, before, after, targets, options, availability } =
    input;
  const project = (commitments: Commitments) =>
    applyAvailability(
      applyCommitments(baseline, plan, commitments, targets, options),
      availability,
    );
  const old = project(before),
    next = project(after);
  const totals = (calendar: WeekSchedule) => {
    const entries = calendar.days.flatMap((d) => d.sessions),
      runs = entries.filter((s) => s.session.sport === "running");
    return {
      km: runs.reduce(
        (n, s) =>
          n +
          (s.session.sport === "running"
            ? workoutKm(s.session.workout, plan.easyPace)
            : 0),
        0,
      ),
      runs: runs.length,
      support: entries.filter((s) => s.session.sport !== "running").length,
    };
  };
  const b = totals(old),
    a = totals(next);
  const changed =
    JSON.stringify(old.days.map((d) => d.sessions)) !==
    JSON.stringify(next.days.map((d) => d.sessions));
  return {
    start: plan.start,
    beforeKm: b.km,
    afterKm: a.km,
    runs: a.runs,
    removedSupport: Math.max(0, b.support - a.support),
    changed,
  };
}
