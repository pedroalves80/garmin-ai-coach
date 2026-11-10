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
    r.terrain === "trail" ||
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
        "A race preparation or recovery window is active. Hold mileage and quality progression.",
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
        "This week intersects race preparation or recovery. Hold normal mileage and quality progression.",
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
): RunWorkout {
  return {
    dayOffset: w.dayOffset,
    title,
    type: "recovery",
    steps: [
      {
        kind: "step",
        name: "Run",
        amount: { kind: "distance", meters },
        target: {
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
  const reduce = (day: ScheduledDay, title: string) => {
    day.sessions = day.sessions.flatMap<SessionState>((entry) =>
      entry.status === "recorded"
        ? [entry]
        : entry.session.sport === "running"
          ? [
              {
                ...entry,
                session: {
                  ...entry.session,
                  workout: recoveryRun(entry.session.workout, targets, title),
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
          "Race recovery window: remove secondary training and quality. Recovery duration is a planning minimum; symptoms and check-ins take precedence.",
        ],
      };
      if (daysBetween(day.day, after.day) <= raceWindow(after).fullRest)
        day.sessions = keepHistory(day);
      else reduce(day, "Post-race recovery · 5 km");
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
          "Reduce training around the event; do not make up removed mileage.",
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
              workout: recoveryRun(
                w,
                targets,
                "Race preparation · recovery HR",
                Math.max(
                  5000,
                  Math.floor((workoutKm(w, plan.easyPace) * 750) / 10) * 10,
                ),
              ),
            },
          },
        ];
      });
    }
    if (weekRaces.length && !returning && !after) {
      day.rule ??= {
        phase: "race_week",
        notes: [
          "The race replaces this week's quality session and long run. Other mileage may be reduced.",
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
                    "Race-week base run",
                  ),
                },
              },
            ]
          : [entry];
      });
    }
    if (
      (returning || after) &&
      day.day === options.today &&
      !options.returnReady
    ) {
      day.sessions = keepHistory(day);
      day.warnings.push(
        "Log a current low-fatigue, pain-free check-in and sync before resuming running.",
      );
    }
    if (
      (returning || after) &&
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
              ? workoutKm(s.session.workout, plan.easyPace)
              : 0),
          0,
        );
    const raceKm = result.days
        .flatMap((d) => d.sessions)
        .reduce(
          (n, s) =>
            n +
            (s.session.sport === "running" && s.session.workout.race
              ? workoutKm(s.session.workout, plan.easyPace)
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
      day.sessions = day.sessions.filter(
        (s) =>
          s.status !== "planned" ||
          s.session.sport !== "running" ||
          !!s.session.workout.race,
      );
      day.rule ??= { phase: "race_week", notes: [] };
      day.rule.notes.push(
        "Ordinary running removed to keep the race inside the weekly distance budget; no catch-up sessions.",
      );
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
