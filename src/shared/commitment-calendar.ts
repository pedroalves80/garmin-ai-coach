import { workoutMileageKm } from "./mileage";
import type {
  Commitments,
  RaceEvent,
  TrainingPause,
} from "./types/commitments";
import type { RunningTargets } from "./types/athlete";
import type { RunWorkout, TrainingPlan } from "./types/metrics";
import type {
  ScheduledDay,
  WeekSchedule,
  SessionState,
} from "./types/schedule";
import { dayOffsetDate, validateDaySessions } from "./weekly-schedule";
import { workoutKm } from "./training-plan";
export function daysBetween(a: string, b: string) {
  return Math.round(
    (Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000,
  );
}
export function pauseEnd(p: TrainingPause) {
  const resumed = p.resumeOn ? dayOffsetDate(p.resumeOn, -1) : null;
  return resumed && (!p.end || resumed < p.end) ? resumed : p.end;
}
export function pauseActive(p: TrainingPause, day: string) {
  const end = pauseEnd(p);
  return !p.cancelled && day >= p.start && (!end || day <= end);
}
export function pendingReturn(p: TrainingPause, day: string) {
  return (
    !p.cancelled &&
    p.start <= day &&
    !pauseActive(p, day) &&
    (!p.returnReviewedAt || day < p.returnReviewedAt)
  );
}
export function raceWindow(r: RaceEvent) {
  const demanding =
    r.expectedMinutes >= 120 ||
    r.distanceKm >= 21.1 ||
    (r.elevationGain ?? 0) >= 500;
  return {
    lead: r.priority === "training" ? 2 : demanding ? 14 : 7,
    recovery: r.distanceKm >= 42 ? 14 : demanding ? 7 : 3,
    fullRest: r.distanceKm >= 42 ? 3 : demanding ? 2 : 1,
  };
}
export function calendarGate(
  c: Commitments,
  today: string,
  weekStart?: string,
) {
  const paused = c.pauses.find((p) => pauseActive(p, today));
  if (paused)
    return {
      blocked: true,
      reason: "Training is paused. No missed mileage should be made up.",
    };
  const pending = c.pauses.find((p) => pendingReturn(p, today));
  if (pending)
    return {
      blocked: true,
      reason:
        "Review your return from the break before resuming training or progression.",
    };
  const returning = c.pauses.find(
    (p) =>
      !p.cancelled &&
      p.returnReviewedAt &&
      daysBetween(today, p.returnReviewedAt) >= 0 &&
      !p.baselineReviewedAt,
  );
  if (returning)
    return {
      blocked: true,
      reason:
        "Consolidate recovery runs until you explicitly save a return baseline. Hold volume and quality increases.",
    };
  const race = c.races.find(
    (r) =>
      r.status !== "cancelled" &&
      daysBetween(r.day, today) <= raceWindow(r).lead &&
      daysBetween(today, r.day) <= raceWindow(r).recovery,
  );
  if (race)
    return {
      blocked: true,
      reason:
        "Race preparation/recovery adjusts intensity and placement. Mileage follows its milestone unless recovery or calendar constraints require an exception.",
    };
  if (
    weekStart &&
    c.races.some(
      (r) =>
        r.status !== "cancelled" &&
        daysBetween(r.day, weekStart) >= -raceWindow(r).recovery &&
        daysBetween(r.day, weekStart) <= 6 + raceWindow(r).lead,
    )
  )
    return {
      blocked: true,
      reason:
        "This week intersects race preparation/recovery: keep quality controlled and review session placement; the mileage milestone is not automatically frozen.",
    };
  if (
    weekStart &&
    c.pauses.some(
      (p) =>
        !p.cancelled &&
        Array.from({ length: 7 }, (_, i) => dayOffsetDate(weekStart, i)).some(
          (d) => pauseActive(p, d),
        ),
    )
  )
    return {
      blocked: true,
      reason:
        "This week includes a planned break. Preserve recovery instead of increasing load.",
    };
  return { blocked: false, reason: "" };
}
export function eventOnlyPlan(
  start: string,
  easyPace: number,
  tempoPace: number,
): TrainingPlan {
  return {
    start,
    weekNumber: 1,
    targetKm: 0,
    easyPace,
    tempoPace,
    cutback: true,
    workouts: [],
  };
}
export function raceWorkout(
  r: RaceEvent,
  offset: number,
  targets: RunningTargets,
): RunWorkout {
  return {
    dayOffset: offset,
    title: r.name,
    type: "race",
    race: r,
    steps: [
      {
        kind: "step",
        name: "Warm Up",
        amount: { kind: "distance", meters: 1000 },
        target: {
          kind: "hr",
          min: targets.recoveryMin,
          max: targets.recoveryMax,
        },
      },
      {
        kind: "step",
        name: "Run",
        amount: { kind: "distance", meters: Math.round(r.distanceKm * 1000) },
        target: {
          kind: "effort",
          min: r.priority === "goal" ? 7 : 6,
          max: r.priority === "goal" ? 9 : 7,
        },
      },
      {
        kind: "step",
        name: "Cool Down",
        amount: { kind: "distance", meters: 500 },
        target: {
          kind: "hr",
          min: targets.recoveryMin,
          max: targets.recoveryMax,
        },
      },
    ],
  };
}
function recoveryRun(
  w: RunWorkout,
  targets: RunningTargets,
  title: string,
  meters = 5000,
  preserveTrail = false,
): RunWorkout {
  return {
    dayOffset: w.dayOffset,
    title,
    type: "recovery",
    ...(preserveTrail && w.trail
      ? {
          trail: {
            expectedMinutes: Math.max(
              15,
              Math.round(
                (w.trail.expectedMinutes * meters) / (workoutKm(w, 375) * 1000),
              ),
            ),
            ...(w.trail.ascentM !== undefined
              ? { ascentM: w.trail.ascentM }
              : {}),
          },
        }
      : {}),
    steps: [
      {
        kind: "step",
        name: "Run",
        amount: { kind: "distance", meters },
        target:
          preserveTrail && w.trail
            ? { kind: "effort", min: 2, max: 3 }
            : {
                kind: "hr",
                min: targets.recoveryMin,
                max: targets.recoveryMax,
              },
      },
    ],
  };
}
export function applyCommitments(
  calendar: WeekSchedule,
  plan: TrainingPlan,
  c: Commitments,
  targets: RunningTargets,
  options: {
    today: string;
    returnReady: boolean;
    approvedRestDays?: string[];
    longestRecentKm?: number;
    allowMileageAllocation?: boolean;
    raceRecovery?: { stopRunning: boolean; reasons: string[] };
  },
): WeekSchedule {
  const races = c.races.filter((r) => r.status !== "cancelled"),
    weekEnd = dayOffsetDate(calendar.start, 7),
    weekRaces = races.filter((r) => r.day >= calendar.start && r.day < weekEnd);
  const result: WeekSchedule = {
    start: calendar.start,
    days: calendar.days.map((day) => ({
      ...day,
      sessions: day.sessions.map((s) => ({ ...s })),
      warnings: [...day.warnings],
    })),
  };
  const keepHistory = (day: ScheduledDay) =>
    day.sessions.filter((s) => s.status === "recorded");
  const reduce = (
    day: ScheduledDay,
    title: string,
    preserveDistance = false,
  ) => {
    day.sessions = day.sessions.flatMap<SessionState>((entry) =>
      entry.status === "recorded"
        ? [entry]
        : entry.session.sport === "running"
          ? [
              {
                ...entry,
                session: {
                  ...entry.session,
                  workout: recoveryRun(
                    entry.session.workout,
                    targets,
                    title,
                    preserveDistance
                      ? Math.round(
                          workoutKm(entry.session.workout, plan.easyPace) *
                            1000,
                        )
                      : 5000,
                    preserveDistance,
                  ),
                },
              },
            ]
          : [],
    );
  };
  // Precedence: break/return hold, fixed race, reduced return/recovery, then ordinary training.
  for (const day of result.days) {
    const pause = c.pauses.find((p) => pauseActive(p, day.day)),
      pending = c.pauses.find((p) => pendingReturn(p, day.day));
    if (pause || pending) {
      day.sessions = keepHistory(day);
      day.rule = {
        phase: pause ? "paused" : "return_review",
        notes: [
          pause
            ? `Training break: ${pause.reason}. No running, cycling or Hyrox is prescribed.`
            : "Return review needed. Log a current recovery check-in, then review your return.",
        ],
      };
      const race = weekRaces.find((r) => r.day === day.day);
      if (race) {
        day.warnings = day.warnings.filter(
          (w) => !w.startsWith("Sunday remains"),
        );
        day.race = race;
        day.warnings.push(
          "The race conflicts with the training break. It remains in your event list but is not prescribed.",
        );
      }
      continue;
    }
    const race = weekRaces.find((r) => r.day === day.day);
    const returnConflict = c.pauses.some(
      (p) =>
        !p.cancelled &&
        p.returnReviewedAt &&
        daysBetween(day.day, p.returnReviewedAt) >= 0 &&
        (!p.baselineReviewedAt ||
          daysBetween(day.day, p.baselineReviewedAt) < 7),
    );
    const recoveryConflict = races.find(
      (r) =>
        r.day < day.day &&
        daysBetween(day.day, r.day) <= raceWindow(r).recovery,
    );
    if (race && (returnConflict || recoveryConflict)) {
      day.race = race;
      day.sessions = keepHistory(day);
      day.rule = {
        phase: returnConflict ? "return" : "race_recovery",
        notes: [
          returnConflict
            ? "This registered event overlaps an active return review. It remains visible but is not prescribed."
            : `This registered event is ${daysBetween(day.day, recoveryConflict!.day)} days after the ${recoveryConflict!.day} race, within its ${raceWindow(recoveryConflict!).recovery}-day recovery window. It remains visible but is not prescribed; review participation and race priorities.`,
        ],
      };
      continue;
    }
    if (race) {
      day.warnings = day.warnings.filter(
        (w) => !w.startsWith("Sunday remains"),
      );
      day.race = race;
      day.rule = {
        phase: "race",
        notes: [
          "The race replaces the ordinary run and later training. Race time takes precedence over normal lunch scheduling.",
        ],
      };
      if (options.approvedRestDays?.includes(day.day)) {
        day.sessions = keepHistory(day);
        day.warnings.push(
          "An approved rest decision suppresses this race. Reassess readiness before changing that decision.",
        );
        continue;
      }
      const recordedKm = day.recorded
        .filter((a) => a.sport === "running")
        .reduce((n, a) => n + a.km, 0);
      if (race.status === "completed" && recordedKm < race.distanceKm * 0.9) {
        day.sessions = keepHistory(day).filter(
          (s) => s.session.sport !== "running",
        );
        day.rule.notes.push(
          "Event marked completed. Do not repeat the race; recorded activities remain in history.",
        );
        continue;
      }
      const status =
        recordedKm >= race.distanceKm * 0.9
          ? "recorded"
          : day.recorded.length >= 2
            ? "blocked"
            : "planned";
      day.sessions = [
        ...(day.dayOffset === 6
          ? []
          : keepHistory(day).filter((s) => s.session.sport !== "running")),
        {
          status,
          session: {
            sport: "running",
            slot: "event",
            workout: raceWorkout(race, day.dayOffset, targets),
          },
        },
      ];
      if (
        !options.longestRecentKm ||
        race.distanceKm > options.longestRecentKm * 1.1
      )
        day.warnings.push(
          "Review race distance, terrain and recent long-run preparation. Entering an event does not establish readiness or permission to increase training mileage.",
        );
      if (race.terrain === "trail")
        day.warnings.push(
          "Trail distance is not equivalent to flat-road distance. Elevation, descent and technical terrain need separate preparation and recovery.",
        );
      validateDaySessions(
        day.dayOffset,
        day.sessions
          .filter((s) => s.status !== "blocked")
          .map((s) => s.session),
        plan.easyPace,
        race,
      );
      continue;
    }
    if (
      c.pauses.some(
        (p) => !p.cancelled && p.staleWeeks?.includes(calendar.start),
      )
    ) {
      day.sessions = keepHistory(day);
      day.rule = {
        phase: "return_review",
        notes: [
          "This future week was saved before the return baseline. Review and save it again at your current baseline before training.",
        ],
      };
      continue;
    }
    const returning = c.pauses.find(
      (p) =>
        !p.cancelled &&
        p.returnReviewedAt &&
        daysBetween(day.day, p.returnReviewedAt) >= 0 &&
        (!p.baselineReviewedAt || day.day < p.baselineReviewedAt),
    );
    if (returning) {
      day.rule = {
        phase: "return",
        notes: [
          "Return phase: recovery runs only, at most 5 km per prescribed run, with no supporting sessions. This stays reduced until you explicitly review a new baseline.",
        ],
      };
      reduce(day, "Return from break · recovery HR");
    }
    const baselineReturn = c.pauses.find(
      (p) =>
        !p.cancelled &&
        p.baselineReviewedAt &&
        daysBetween(day.day, p.baselineReviewedAt) >= 0 &&
        daysBetween(day.day, p.baselineReviewedAt) < 7,
    );
    if (baselineReturn) {
      day.rule = {
        phase: "return",
        notes: [
          "Reviewed recovery baseline: keep running at recovery effort and leave secondary training out for seven days.",
        ],
      };
      day.sessions = day.sessions.filter(
        (s) => s.status === "recorded" || s.session.sport === "running",
      );
    }
    const after = races.find(
      (r) =>
        daysBetween(day.day, r.day) > 0 &&
        daysBetween(day.day, r.day) <= raceWindow(r).recovery,
    );
    if (after) {
      day.rule = {
        phase: "race_recovery",
        notes: [
          `After ${after.day}: remove supporting sessions and running intensity first. Retain prescribed distances after ${raceWindow(after).fullRest} initial rest day(s); the ${raceWindow(after).recovery}-day window restricts intensity, not every run to 5 km. Recovery remains provisional, not a clearance.`,
        ],
      };
      if (daysBetween(day.day, after.day) <= raceWindow(after).fullRest)
        day.sessions = keepHistory(day);
      else if (
        after.day <= options.today &&
        options.raceRecovery?.reasons.length
      ) {
        day.rule.notes.push(...options.raceRecovery.reasons);
        if (options.raceRecovery.stopRunning) day.sessions = keepHistory(day);
        else reduce(day, "Post-race recovery · reduced for recovery evidence");
      } else if (after.distanceKm >= 42 || after.expectedMinutes >= 240) {
        day.rule.notes.push(
          "Major-event safeguard: marathon distance or an estimated outing of at least four hours retains reduced-distance recovery. This planning threshold is a conservative app rule, not an individualized recovery prediction.",
        );
        reduce(day, "Post-race recovery · major-event distance reduction");
      } else
        reduce(
          day,
          "Post-race recovery · distance retained",
          !returning && !baselineReturn,
        );
    }
    const before = races.find(
      (r) =>
        daysBetween(r.day, day.day) > 0 &&
        daysBetween(r.day, day.day) <= raceWindow(r).lead,
    );
    if (before && !returning && !after) {
      const diff = daysBetween(before.day, day.day);
      day.rule = {
        phase: "taper",
        notes: [
          before.priority === "training"
            ? "Training event: retain ordinary run distances at recovery effort. The event replaces the long run and quality; remove nearby supporting sessions first."
            : "Goal-race taper: reduce intensity and selected run distances deliberately to prioritize this event. No missed mileage is made up.",
        ],
      };
      day.sessions = day.sessions.flatMap<SessionState>((entry) => {
        if (entry.status === "recorded") return [entry];
        if (diff === 1 && before.priority === "goal") return [];
        if (entry.session.sport !== "running")
          return diff <= (before.terrain === "trail" ? 7 : 3) ? [] : [entry];
        const w = entry.session.workout;
        if (w.type === "long") return [];
        return [
          {
            ...entry,
            session: {
              ...entry.session,
              workout: {
                ...recoveryRun(
                  w,
                  targets,
                  "Race preparation · recovery HR",
                  Math.max(
                    5000,
                    Math.floor(
                      (workoutKm(w, plan.easyPace) *
                        (before.priority === "training" ||
                        w.calendarAdjustment?.raceId === before.id
                          ? 1000
                          : 750)) /
                        10,
                    ) * 10,
                  ),
                  true,
                ),
                calendarAdjustment: { raceId: before.id, phase: "preparation" },
              },
            },
          },
        ];
      });
    }
    if (weekRaces.length && !returning && !after) {
      day.rule ??= {
        phase: "race_week",
        notes: [
          "Race-course distance counts towards weekly mileage; race warm-up/cool-down remain in physical load outside the target. The event replaces the long run and quality. Retain other distances where the reviewed budget allows; do not add catch-up kilometres.",
        ],
      };
      day.sessions = day.sessions.flatMap<SessionState>((entry) => {
        if (entry.status !== "planned" || entry.session.sport !== "running")
          return [entry];
        if (entry.session.workout.type === "long") return [];
        return ["quality", "strides"].includes(entry.session.workout.type)
          ? [
              {
                ...entry,
                session: {
                  ...entry.session,
                  workout: recoveryRun(
                    entry.session.workout,
                    targets,
                    "Race-week base run · distance retained",
                    Math.round(
                      workoutKm(entry.session.workout, plan.easyPace) * 1000,
                    ),
                    true,
                  ),
                },
              },
            ]
          : [entry];
      });
    }
    if (returning && day.day === options.today && !options.returnReady) {
      day.sessions = keepHistory(day);
      day.warnings.push(
        "Log a current low-fatigue, pain-free check-in and sync before resuming running.",
      );
    }
    if (
      (returning ||
        (after &&
          after.day <= options.today &&
          !!options.raceRecovery?.reasons.length)) &&
      day.sessions.some(
        (s) => s.status === "planned" && s.session.sport === "running",
      )
    ) {
      const previous = result.days[day.dayOffset - 1];
      if (
        previous?.sessions.some(
          (s) => s.status === "planned" && s.session.sport === "running",
        )
      )
        day.sessions = keepHistory(day);
    }
  }
  // Preserve history and course distance; remove ordinary prescriptions instead of adding catch-up mileage.
  if (weekRaces.length) {
    const total = () =>
      result.days
        .flatMap((d) => d.sessions)
        .reduce(
          (n, s) =>
            n +
            (s.session.sport === "running"
              ? workoutMileageKm(s.session.workout, plan.easyPace)
              : 0),
          0,
        );
    const raceKm = result.days
        .flatMap((d) => d.sessions)
        .reduce(
          (n, s) =>
            n +
            (s.session.sport === "running" && s.session.workout.race
              ? workoutMileageKm(s.session.workout, plan.easyPace)
              : 0),
          0,
        ),
      cap = Math.max(plan.targetKm, raceKm);
    const candidates = result.days
      .filter((d) =>
        d.sessions.some(
          (s) =>
            s.status === "planned" &&
            s.session.sport === "running" &&
            !s.session.workout.race,
        ),
      )
      .sort(
        (a, b) =>
          Math.min(
            ...weekRaces.map((r) => Math.abs(daysBetween(a.day, r.day))),
          ) -
          Math.min(
            ...weekRaces.map((r) => Math.abs(daysBetween(b.day, r.day))),
          ),
      );
    for (const day of candidates) {
      if (total() <= cap + 0.001) break;
      const excess = Math.ceil((total() - cap) * 1000 - 1e-6);
      const entry = day.sessions.find(
        (s) =>
          s.status === "planned" &&
          s.session.sport === "running" &&
          !s.session.workout.race,
      )!;
      const run = entry.session;
      const remainingMeters =
        run.sport === "running"
          ? Math.round(workoutKm(run.workout, plan.easyPace) * 1000) - excess
          : 0;
      if (run.sport === "running" && remainingMeters >= 5000) {
        day.sessions = day.sessions.map((s) =>
          s === entry
            ? {
                ...s,
                session: {
                  ...run,
                  workout: recoveryRun(
                    run.workout,
                    targets,
                    "Race-week base run · distance budget",
                    remainingMeters,
                    true,
                  ),
                },
              }
            : s,
        );
      } else {
        day.sessions = day.sessions.filter((s) => s !== entry);
      }
      day.rule ??= { phase: "race_week", notes: [] };
      day.rule.notes.push(
        remainingMeters >= 5000
          ? "Only the excess distance is trimmed to fit the event inside the reviewed weekly budget. Running frequency is preserved."
          : "An ordinary run cannot fit the reviewed budget while keeping your 5 km minimum. It is removed rather than increasing weekly volume or adding catch-up distance.",
      );
    }
    const guardRemovedRunning = result.days.some(
      (day, i) =>
        day.rule &&
        ["paused", "return_review", "return", "race_recovery"].includes(
          day.rule.phase,
        ) &&
        calendar.days[i].sessions.some(
          (s) => s.status === "planned" && s.session.sport === "running",
        ) &&
        day.sessions.filter(
          (s) => s.status === "planned" && s.session.sport === "running",
        ).length <
          calendar.days[i].sessions.filter(
            (s) => s.status === "planned" && s.session.sport === "running",
          ).length,
    );
    if (
      options.allowMileageAllocation !== false &&
      raceKm > 0 &&
      weekRaces.every((r) => r.priority === "training") &&
      !guardRemovedRunning
    ) {
      let spare = Math.floor((plan.targetKm - total()) * 1000 + 1e-6);
      const maxRun = Math.max(
        5000,
        ...plan.workouts.map((w) =>
          Math.round(workoutKm(w, plan.easyPace) * 1000),
        ),
      );
      for (const day of [...candidates].reverse()) {
        if (spare <= 0) break;
        if (
          day.day < options.today ||
          day.recorded.some((r) => r.sport === "running")
        )
          continue;
        const entry = day.sessions.find(
          (s) =>
            s.status === "planned" &&
            s.session.sport === "running" &&
            !s.session.workout.race,
        );
        if (!entry || entry.session.sport !== "running") continue;
        const run = entry.session,
          meters = Math.round(workoutKm(run.workout, plan.easyPace) * 1000);
        const max =
          day.dayOffset < 5 && run.slot === "lunch"
            ? Math.min(maxRun, Math.floor((7200 / plan.easyPace) * 1000))
            : maxRun;
        const add = Math.min(spare, Math.max(0, max - meters));
        if (add <= 0) continue;
        entry.session = {
          ...run,
          workout: recoveryRun(
            run.workout,
            targets,
            "Base run · race-week mileage allocation",
            meters + add,
            true,
          ),
        };
        spare -= add;
        day.rule ??= { phase: "race_week", notes: [] };
        day.rule.notes.push(
          "Distance is allocated within this training-event week's reviewed mileage target. Race extras are separate; no rested or missed run is made up, and no run exceeds the base plan's longest distance.",
        );
      }
    }
    if (raceKm > plan.targetKm && plan.targetKm > 0)
      for (const day of result.days.filter((d) => d.race))
        day.warnings.push(
          "The race itself exceeds the reviewed weekly distance. The calendar records your commitment; it is not an endorsement of readiness.",
        );
    if (weekRaces.length > 1)
      for (const day of result.days.filter((d) => d.race))
        day.warnings.push(
          "Multiple races share this week. Their recovery windows overlap; review participation and priorities.",
        );
  }
  return result;
}
