import type Database from "better-sqlite3";
import type { ActivityMeasurement } from "../../shared/types/metrics";
import type {
  Commitments,
  AutomaticRaceRecovery,
} from "../../shared/types/commitments";
import {
  activeRaceSchedule,
  daysBetween,
  raceRevision,
  raceWindow,
} from "../../shared/race-policy";
import { pauseActive, pendingReturn } from "../../shared/commitment-calendar";
import { prepare } from "../db/statements";
import { calendarDate, shiftDay } from "./dates";
import { observeRaces } from "./race-observations";
import { workoutReviews } from "./workout-reviews";
import { TrainingRepository } from "./repository";
import { AthleteRepository } from "./athlete-repository";
import { garminRecovery, type HealthEvidenceRow } from "./recovery";
import { sportGroup } from "./metrics";

// Only compare dedicated road runs in closely matched conditions. Raw location
// data stays local; neither coordinates nor raw Garmin JSON enter the decision.
function roadSample(a: ActivityMeasurement) {
  if (
    a.sportType !== "running" ||
    sportGroup(a) !== "running" ||
    !a.distanceMeters ||
    !a.durationSeconds ||
    !a.averageHeartRate
  )
    return null;
  try {
    const raw = JSON.parse(a.rawJson) as Record<string, unknown>;
    const number = (k: string) =>
      typeof raw[k] === "number" && Number.isFinite(raw[k])
        ? (raw[k] as number)
        : null;
    const gain = number("elevationGain"),
      lat = number("startLatitude"),
      lon = number("startLongitude"),
      low = number("minTemperature"),
      high = number("maxTemperature");
    if (
      gain === null ||
      gain < 0 ||
      lat === null ||
      lon === null ||
      low === null ||
      high === null
    )
      return null;
    return {
      a,
      pace: a.durationSeconds / (a.distanceMeters / 1000),
      climb: gain / (a.distanceMeters / 1000),
      lat,
      lon,
      temp: (low + high) / 2,
    };
  } catch {
    return null;
  }
}
function paceConcern(a: ActivityMeasurement, baseline: ActivityMeasurement[]) {
  const next = roadSample(a);
  if (!next) return null;
  const matches = baseline
    .map(roadSample)
    .filter(
      (old) =>
        old &&
        Math.hypot(
          (old.lat - next.lat) * 111,
          (old.lon - next.lon) * 111 * Math.cos((next.lat * Math.PI) / 180),
        ) <= 0.25 &&
        Math.abs(old.a.averageHeartRate! - next.a.averageHeartRate!) <= 3 &&
        Math.abs(old.a.distanceMeters! / next.a.distanceMeters! - 1) <= 0.15 &&
        Math.abs(old.climb - next.climb) <= 5 &&
        Math.abs(old.temp - next.temp) <= 5,
    )
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (matches.length < 3) return null;
  const paces = matches.map((x) => x.pace).sort((x, y) => x - y),
    i = Math.floor(paces.length / 2);
  const median = paces.length % 2 ? paces[i] : (paces[i - 1] + paces[i]) / 2;
  // A conservative review flag, not a validated threshold or a fitness estimate.
  return next.pace > median * 1.12;
}

// Read-only, deterministic and provider-free. Evidence can authorize only the
// existing base range; it cannot change mileage, calibration, pace or quality.
export function assessRaceRecoveries(
  db: Database.Database,
  commitments: Commitments,
  activities: ActivityMeasurement[],
  now: Date,
): Commitments {
  const observed = observeRaces(commitments, activities, now),
    today = calendarDate(now);
  const current = observed.races.filter(
    (r) =>
      r.status !== "cancelled" &&
      daysBetween(today, r.day) >= 0 &&
      daysBetween(today, r.day) <= raceWindow(r).recovery,
  );
  if (!current.length) return observed;
  const health = prepare(
    db,
    "SELECT day,resting_heart_rate AS restingHeartRate,sleep_seconds AS sleepSeconds FROM daily_health WHERE day>=? AND day<=? ORDER BY day",
  ).all(shiftDay(today, -28), today) as HealthEvidenceRow[];
  const recovery = garminRecovery(health, today),
    latest = health.at(-1);
  const sync = prepare(
    db,
    "SELECT last_completed_at FROM sync_state WHERE provider='garmin'",
  ).get() as { last_completed_at: string | null } | undefined;
  const age = now.getTime() - Date.parse(sync?.last_completed_at ?? "");
  const syncFresh = Number.isFinite(age) && age >= 0 && age <= 2 * 86400000;
  const repo = new TrainingRepository(db),
    reports = repo.checkIns().filter((c) => c.day <= today);
  const reviews = workoutReviews(db, now).reviews;
  const targets = new AthleteRepository(db).profile().targets;
  const active = activeRaceSchedule(observed.races).active;
  const completed = activities.filter(
    (a) =>
      a.durationSeconds &&
      a.durationSeconds > 0 &&
      Date.parse(a.startedAt) + a.durationSeconds * 1000 <= now.getTime(),
  );
  return {
    ...observed,
    races: observed.races.map((r) => {
      if (!current.some((x) => x.id === r.id)) return r;
      const window = raceWindow(r),
        elapsed = daysBetween(today, r.day);
      const post = completed
        .filter(
          (a) =>
            sportGroup(a) === "running" &&
            calendarDate(new Date(a.startedAt)) >
              shiftDay(r.day, window.fullRest) &&
            calendarDate(new Date(a.startedAt)) <= today,
        )
        .filter(
          (a) =>
            calendarDate(new Date(a.startedAt)) <=
            shiftDay(r.day, window.recovery),
        )
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const qualifying = post.filter((a) => {
        const review = reviews.find((x) => x.activityId === a.id),
          w = review?.snapshot?.workout;
        return (
          review?.versionKnown &&
          ["automatic", "manual"].includes(review.match) &&
          review.distanceStatus === "met" &&
          w?.type === "recovery" &&
          !w.race &&
          !w.trail &&
          a.sportType !== "trail_running" &&
          a.averageHeartRate !== null &&
          a.averageHeartRate >= 90 &&
          a.averageHeartRate <=
            Math.min(targets.recoveryMax + 3, targets.baseMax) &&
          w.steps.every(
            (s) =>
              s.kind === "step" &&
              s.target.kind === "hr" &&
              s.target.max <= targets.recoveryMax,
          ) &&
          review.feeling !== "harder"
        );
      });
      const runDays = new Set(
        qualifying.map((a) => calendarDate(new Date(a.startedAt))),
      );
      // A run already restored automatically may maintain the decision after a
      // subsequent supportive night. It cannot supply the initial two recovery days.
      const toleratedAutomaticBase = (a: ActivityMeasurement) => {
        const review = reviews.find((x) => x.activityId === a.id),
          w = review?.snapshot?.workout;
        return (
          review?.versionKnown &&
          ["automatic", "manual"].includes(review.match) &&
          review.distanceStatus === "met" &&
          review.feeling !== "harder" &&
          w?.type === "base" &&
          w.title === "Post-race return · automatically reassessed base" &&
          !w.trail &&
          a.sportType !== "trail_running" &&
          a.averageHeartRate !== null &&
          a.averageHeartRate >= 90 &&
          a.averageHeartRate <= targets.baseMax + 3 &&
          w.steps.every(
            (s) =>
              s.kind === "step" &&
              s.target.kind === "hr" &&
              s.target.max <= targets.baseMax,
          )
        );
      };
      const latestRun = post.at(-1),
        lastRunDay = latestRun
          ? calendarDate(
              new Date(
                Date.parse(latestRun.startedAt) +
                  latestRun.durationSeconds! * 1000,
              ),
            )
          : null;
      const relevantReports = reports
        .filter((c) => c.day >= shiftDay(today, -7))
        .sort((a, b) => b.day.localeCompare(a.day));
      const knownConcern =
        (relevantReports[0] &&
          (relevantReports[0].pain > 0 ||
            relevantReports[0].fatigue >= 3 ||
            relevantReports[0].soreness >= 3)) ||
        relevantReports.some(
          (c) =>
            c.day >= shiftDay(today, -2) &&
            (c.pain > 0 || c.fatigue >= 3 || c.soreness >= 3),
        );
      const feedbackConcern = post.some(
        (a) => reviews.find((x) => x.activityId === a.id)?.feeling === "harder",
      );
      const effortConcern = prepare(
        db,
        "SELECT e.rpe,a.started_at,a.sport_type,a.name FROM session_efforts e JOIN activities a ON a.id=e.activity_id WHERE a.started_at>=? AND a.started_at<=?",
      ).all(shiftDay(today, -2) + "T00:00:00Z", now.toISOString()) as {
        rpe: number;
        started_at: string;
        sport_type: string;
        name: string | null;
      }[];
      const hardRecent =
        effortConcern.some(
          (e) => calendarDate(new Date(e.started_at)) > r.day && e.rpe >= 5,
        ) ||
        completed.some(
          (a) =>
            calendarDate(new Date(a.startedAt)) > r.day &&
            calendarDate(new Date(a.startedAt)) >= shiftDay(today, -1) &&
            sportGroup(a) === "hyrox",
        );
      const baseline = completed
        .filter(
          (a) =>
            calendarDate(new Date(a.startedAt)) < r.day &&
            calendarDate(new Date(a.startedAt)) >= shiftDay(r.day, -42),
        )
        .filter((a) => {
          const rev = reviews.find((x) => x.activityId === a.id);
          return (
            rev?.versionKnown &&
            ["automatic", "manual"].includes(rev.match) &&
            ["base", "recovery"].includes(rev.snapshot?.workout?.type ?? "") &&
            !rev.snapshot?.workout?.trail
          );
        });
      const comparisons = post
        .filter(
          (a) =>
            qualifying.some((x) => x.id === a.id) || toleratedAutomaticBase(a),
        )
        .map((a) => paceConcern(a, baseline));
      const paceComparison: AutomaticRaceRecovery["paceComparison"] =
        comparisons.some((x) => x === true)
          ? "caution"
          : comparisons.some((x) => x === false)
            ? "no_concern"
            : "unavailable";
      const reasons: string[] = [];
      if (elapsed <= window.fullRest)
        reasons.push(
          `Initial rest remains: ${window.fullRest} day(s) after the race. No automatic return during initial rest.`,
        );
      if (!r.recorded)
        reasons.push(
          "A matching completed Garmin race recording is needed; entered race details are not evidence of recovery.",
        );
      if (
        r.distanceKm >= 42 ||
        (r.recorded?.minutes ?? r.expectedMinutes) >= 240
      )
        reasons.push(
          "Major-event safeguard: no automatic return to base after marathon distance or an outing of four hours or more.",
        );
      if (
        !active.some((x) => x.id === r.id) ||
        active.some((x) => x.id !== r.id && x.day > r.day && x.day <= today)
      )
        reasons.push(
          "Another race or unresolved event overlap needs a separate recovery review.",
        );
      if (
        observed.pauses.some(
          (p) =>
            !p.cancelled &&
            (pauseActive(p, today) ||
              pendingReturn(p, today) ||
              (p.returnReviewedAt &&
                (!p.baselineReviewedAt ||
                  daysBetween(today, p.baselineReviewedAt) < 7))),
        )
      )
        reasons.push(
          "A training break or return phase takes precedence over automatic race recovery.",
        );
      if (!syncFresh)
        reasons.push(
          "Garmin sync must be successful and no more than 48 hours old.",
        );
      if (recovery.status !== "supportive")
        reasons.push(
          recovery.status === "caution"
            ? "Garmin sleep/resting-HR flags keep recovery effort in place."
            : "Recent Garmin sleep/resting-HR coverage is incomplete; keep recovery effort while collecting evidence.",
        );
      if (
        latest &&
        ((latest.sleepSeconds ?? 0) < 21600 ||
          latest.restingHeartRate === null ||
          latest.restingHeartRate < 30 ||
          latest.restingHeartRate > 150 ||
          (latest.sleepSeconds ?? 0) > 86400 ||
          recovery.baselineRestingHr === null ||
          latest.restingHeartRate >= recovery.baselineRestingHr + 7)
      )
        reasons.push(
          "The latest Garmin night is short or resting HR is elevated/missing; earlier averages do not override it.",
        );
      if (knownConcern || feedbackConcern || hardRecent)
        reasons.push(
          "Reported symptoms, harder-than-planned running or recent demanding training keep recovery effort in place. Missing reports are not assumed healthy.",
        );
      if (runDays.size < 2)
        reasons.push(
          `${runDays.size}/2 completed, matched recovery-run days with distance met and usable aerobic average HR. Run averages do not prove every step was within target.`,
        );
      if (
        latestRun &&
        !qualifying.some((a) => a.id === latestRun.id) &&
        !toleratedAutomaticBase(latestRun)
      )
        reasons.push(
          "The latest recovery-period run is not a qualifying recovery run or a tolerated automatically restored base run; review its prescription, distance, HR or feedback.",
        );
      if (lastRunDay && (!latest || latest.day <= lastRunDay))
        reasons.push(
          "Wait for Garmin overnight recovery data after the latest recovery run.",
        );
      if (paceComparison === "caution")
        reasons.push(
          "A recovery run was over 12% slower than at least three similar pre-race road runs at similar HR, route, distance, climbing and temperature. This is a review flag, not a diagnosis.",
        );
      const status = reasons.length ? "recovery" : "base";
      return {
        ...r,
        automaticRecovery: {
          status,
          checkedOn: today,
          from: today,
          revision: raceRevision(r),
          recordingRevision: r.recorded ? JSON.stringify(r.recorded) : null,
          recoveryRuns: runDays.size,
          lastRunDay,
          healthDay: recovery.latestDay,
          paceComparison,
          reasons:
            status === "base"
              ? [
                  "Two completed recovery-run days and fresh supportive Garmin overnight data support restoring the existing base range for upcoming, unmodified runs. Distance and quality do not increase.",
                  paceComparison === "unavailable"
                    ? "Comparable pace/HR evidence is unavailable; no efficiency or complete muscular-recovery claim is made."
                    : "Comparable road pace/HR raised no configured concern; averages cannot establish full muscular recovery.",
                  "Rechecked automatically after sync and as the date changes. New concerns or stale/missing data restore recovery effort. Report pain or unusual fatigue whenever needed.",
                ]
              : reasons.slice(0, 5),
        },
      };
    }),
  };
}

// A generated weekly snapshot can be reprojected; an explicit day decision
// stays protected. Bound this list to the rolling future planning horizon.
export function automaticRecoveryProtectedDays(
  db: Database.Database,
  today: string,
) {
  const end = shiftDay(today, 730);
  return (
    prepare(
      db,
      `SELECT day FROM day_schedule_overrides WHERE review_id IS NOT NULL AND day>=? AND day<=?
    UNION SELECT day FROM coach_overrides WHERE day>=? AND day<=?
    UNION SELECT j.value AS day FROM schedule_edit_history h,json_each(h.days_json) j
      WHERE h.undone_at IS NULL AND j.value>=? AND j.value<=?`,
    ).all(today, end, today, end, today, end) as { day: string }[]
  ).map((r) => r.day);
}
