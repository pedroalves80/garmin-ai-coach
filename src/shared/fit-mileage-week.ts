import type { TrainingPlan, RunWorkout } from "./types/metrics";
import type { WeekSchedule, TrainingSession } from "./types/schedule";
import type { Commitments } from "./types/commitments";
import { DEFAULT_TARGETS } from "./types/athlete";
import { calendarMileage } from "./mileage";
import {
  createTrainingPlan,
  volumeMilestones,
  workoutKm,
} from "./training-plan";
import { activeRaceSchedule } from "./race-policy";
import { daysBetween, raceWindow } from "./commitment-calendar";
import { validateDaySessions } from "./weekly-schedule";

// A proposed full week may be arranged around an event. Never pack missed mileage into a partial week.
export function fitMileageWeek(
  calendar: WeekSchedule,
  plan: TrainingPlan,
  commitments: Commitments,
  options: {
    today: string;
    longestRecentKm?: number;
    approvedRestDays?: string[];
    raceRecovery?: { stopRunning: boolean; reasons: string[] };
  },
) {
  const unchanged = { calendar, rebalanced: false };
  const current = calendarMileage(calendar, plan.easyPace).countedKm;
  if (current >= plan.targetKm - 0.001 || options.today > plan.start)
    return unchanged;
  if (
    !calendar.days.some(
      (d) =>
        d.rule &&
        ["race", "race_week", "race_recovery", "taper"].includes(d.rule.phase),
    )
  )
    return unchanged;
  if (
    options.raceRecovery?.reasons.length ||
    calendar.days.some(
      (d) =>
        d.rule && ["paused", "return_review", "return"].includes(d.rule.phase),
    )
  )
    return unchanged;
  if (
    calendar.days.some((d) =>
      d.rule?.notes.some((n) => n.includes("Major-event safeguard")),
    )
  )
    return unchanged;
  const races = activeRaceSchedule(commitments.races, [
    ...(options.approvedRestDays ?? []),
    ...calendar.days
      .filter(
        (d) =>
          d.race &&
          !d.sessions.some(
            (s) => s.session.sport === "running" && s.session.workout.race,
          ),
      )
      .map((d) => d.day),
  ]).active;
  if (
    calendar.days.some(
      (d) =>
        (d.race?.priority === "goal" &&
          d.sessions.some(
            (s) => s.session.sport === "running" && !!s.session.workout.race,
          )) ||
        (d.rule?.phase === "taper" &&
          races.some(
            (r) =>
              r.priority === "goal" &&
              daysBetween(r.day, d.day) > 0 &&
              daysBetween(r.day, d.day) <= raceWindow(r).lead,
          )),
    )
  )
    return unchanged;
  const existing = calendar.days.flatMap((d) =>
    d.sessions
      .filter(
        (s) =>
          s.status === "planned" &&
          s.session.sport === "running" &&
          !s.session.workout.race,
      )
      .map((s) => ({ day: d.dayOffset, entry: s })),
  );
  const locked = calendar.days
    .filter((d) =>
      d.sessions.some(
        (s) =>
          s.session.sport === "running" &&
          (s.status === "recorded" || !!s.session.workout.race),
      ),
    )
    .map((d) => d.dayOffset);
  const lockedKm = calendar.days
    .flatMap((d) => d.sessions)
    .reduce(
      (n, s) =>
        n +
        (s.session.sport === "running" &&
        (s.status === "recorded" || s.session.workout.race)
          ? (s.session.workout.race?.distanceKm ??
            workoutKm(s.session.workout, plan.easyPace))
          : 0),
      0,
    );
  const remaining = Math.round((plan.targetKm - lockedKm) * 1000);
  if (remaining < 5000) return unchanged;
  let peak = plan;
  if (plan.cutback && plan.weekNumber % 4 === 0)
    peak = createTrainingPlan(
      plan.weekNumber - 1,
      plan.start,
      plan.easyPace,
      plan.tempoPace,
      volumeMilestones[plan.weekNumber - 2],
    );
  const peakCap = Math.max(
    ...peak.workouts.map((w) => workoutKm(w, plan.easyPace)),
  );
  const capKm = options.longestRecentKm
    ? Math.min(peakCap, options.longestRecentKm * 1.1)
    : peakCap;
  const eligible = calendar.days.filter(
    (d) =>
      d.dayOffset < 6 &&
      !options.approvedRestDays?.includes(d.day) &&
      !locked.includes(d.dayOffset) &&
      !d.race &&
      !d.recorded.some((r) => r.sport === "running") &&
      d.sessions.filter((s) => s.session.sport !== "running").length < 2 &&
      !races.some(
        (r) =>
          daysBetween(d.day, r.day) > 0 &&
          daysBetween(d.day, r.day) <= raceWindow(r).fullRest,
      ) &&
      ["morning", "lunch", "later"].some(
        (slot) =>
          !d.unavailableSlots?.includes(slot as "morning") &&
          !d.sessions.some(
            (s) => s.session.sport !== "running" && s.session.slot === slot,
          ),
      ),
  );
  const targetRuns = Math.max(1, plan.workouts.length - locked.length);
  const choices: { days: typeof eligible; score: number }[] = [];
  for (let mask = 1; mask < 1 << eligible.length; mask++) {
    const days = eligible.filter((_, i) => mask & (1 << i));
    if (
      days.length * 5000 > remaining ||
      days.length * Math.floor(capKm * 1000) < remaining
    )
      continue;
    const offsets = [...locked, ...days.map((d) => d.dayOffset)];
    if (offsets.some((i) => offsets.includes(i + 1) && offsets.includes(i + 2)))
      continue;
    const kept = days.filter((d) =>
      existing.some((e) => e.day === d.dayOffset),
    ).length;
    choices.push({
      days,
      score: Math.abs(days.length - targetRuns) * 100 - kept * 5,
    });
  }
  choices.sort((a, b) => a.score - b.score);
  const targets = plan.development?.targets ?? DEFAULT_TARGETS;
  for (const choice of choices) {
    let left = remaining;
    const selected = new Map<number, TrainingSession>();
    let invalid = false;
    for (let i = 0; i < choice.days.length; i++) {
      const day = choice.days[i],
        old = existing.find((e) => e.day === day.dayOffset)?.entry.session;
      const meters =
        i === choice.days.length - 1
          ? left
          : Math.floor(left / (choice.days.length - i));
      left -= meters;
      const slot = ([old?.slot, "lunch", "morning", "later"] as const).find(
        (slot) =>
          slot &&
          slot !== "event" &&
          !day.unavailableSlots?.includes(slot) &&
          !day.sessions.some(
            (s) => s.session.sport !== "running" && s.session.slot === slot,
          ),
      );
      if (
        !slot ||
        slot === "event" ||
        (day.dayOffset < 5 &&
          slot === "lunch" &&
          (meters / 1000) * plan.easyPace > 7200)
      ) {
        invalid = true;
        break;
      }
      const prior = old?.sport === "running" ? old.workout : null;
      // Redistribution must not spread one day's post-race restriction across the week.
      // Unrestricted event-week runs stay aerobic; recovery days retain their lower target.
      const recovery =
        (day.rule?.phase === "race_recovery" &&
          day.rule.recoveryEffort !== "base") ||
        prior?.type === "recovery";
      const workout: RunWorkout = {
        dayOffset: day.dayOffset,
        title: recovery
          ? "Recovery run · event-week mileage"
          : "Base run · event-week mileage",
        type: recovery ? "recovery" : "base",
        steps: [
          {
            kind: "step",
            name: "Run",
            amount: { kind: "distance", meters },
            target: prior?.trail
              ? { kind: "effort", min: recovery ? 2 : 3, max: recovery ? 3 : 4 }
              : {
                  kind: "hr",
                  min: recovery ? targets.recoveryMin : targets.baseMin,
                  max: recovery ? targets.recoveryMax : targets.baseMax,
                },
          },
        ],
        ...(prior?.trail
          ? {
              trail: {
                expectedMinutes: Math.max(
                  15,
                  Math.round(
                    (prior.trail.expectedMinutes * meters) /
                      (workoutKm(prior, plan.easyPace) * 1000),
                  ),
                ),
              },
            }
          : {}),
      };
      selected.set(day.dayOffset, {
        sport: "running",
        id: old?.id ?? `${day.day}:running`,
        slot,
        workout,
      });
    }
    if (invalid) continue;
    const next: WeekSchedule = {
      ...calendar,
      days: calendar.days.map((d) => {
        const session = selected.get(d.dayOffset);
        return {
          ...d,
          sessions: [
            ...d.sessions.filter(
              (s) =>
                !(
                  s.status === "planned" &&
                  s.session.sport === "running" &&
                  !s.session.workout.race
                ),
            ),
            ...(session ? [{ session, status: "planned" as const }] : []),
          ],
          warnings: session
            ? [
                ...d.warnings,
                "This proposed week reallocates event-adjusted running across available days at base effort, retaining lower recovery targets only on restricted days. It preserves initial rest, the mileage target and run-distance limits; review recovery before accepting.",
              ]
            : d.warnings,
        };
      }),
    };
    try {
      for (const d of next.days)
        validateDaySessions(
          d.dayOffset,
          d.sessions.map((s) => s.session),
          plan.easyPace,
          d.race,
        );
    } catch {
      continue;
    }
    if (
      Math.abs(calendarMileage(next, plan.easyPace).countedKm - plan.targetKm) <
      0.002
    )
      return { calendar: next, rebalanced: true };
  }
  return unchanged;
}
