import type Database from "better-sqlite3";
import { z } from "zod";
import { prepare } from "../db/statements";
import { GarminRepository } from "../db/garmin-repository";
import {
  prescriptionSnapshots,
  snapshotSignature,
} from "./prescription-snapshots";
import { calendarDate, shiftDay } from "./dates";
import { sportGroup } from "./metrics";
import { countedActivityKm, workoutMileageKm } from "../../shared/mileage";
import { stepMeters } from "../../shared/training-plan";
import type { PlanStep, ActivityMeasurement } from "../../shared/types/metrics";
import type {
  PrescriptionSnapshot,
  WorkoutReview,
  ReviewStep,
  SessionFeeling,
} from "../../shared/types/workout-review";
export class WorkoutReviewError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const reviewInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("link"),
      activityId: z.string().min(1).max(150),
      snapshotId: z.uuid().nullable(),
      revision: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("automatic"),
      activityId: z.string().min(1).max(150),
      revision: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("feedback"),
      activityId: z.string().min(1).max(150),
      feeling: z.enum(["easier", "right", "harder"]).nullable(),
    })
    .strict(),
]);
type Split = {
  splitType: string;
  noOfSplits: number | null;
  distance: number | null;
  duration: number | null;
  averageHR: number | null;
  averageSpeed: number | null;
};
export type ReviewDetail = {
  activityFingerprint: string;
  status: string;
  summary: { splitSummaries: Split[] } | null;
  workouts: unknown[] | null;
};
export function activityReviewFingerprint(a: ActivityMeasurement) {
  return snapshotSignature([
    a.startedAt,
    a.sportType,
    a.name,
    a.distanceMeters,
    a.durationSeconds,
    a.averageHeartRate,
  ]);
}
function flatten(
  steps: PlanStep[],
  depth = 0,
): Extract<PlanStep, { kind: "step" }>[] {
  if (depth > 4) return [];
  const result: Extract<PlanStep, { kind: "step" }>[] = [];
  for (const s of steps) {
    if (result.length >= 300) break;
    if (s.kind === "step") result.push(s);
    else
      for (let i = 0; i < Math.min(s.times, 30) && result.length < 300; i++)
        result.push(...flatten(s.steps, depth + 1));
  }
  return result.slice(0, 300);
}
function stepReview(
  snapshot: PrescriptionSnapshot,
  detail: ReviewDetail | null,
): ReviewStep[] {
  if (!snapshot.workout) return [];
  const steps = flatten(snapshot.workout.steps),
    groups = detail?.summary?.splitSummaries ?? [];
  const role = (type: string) =>
    ({
      INTERVAL_WARMUP: "Warm Up",
      INTERVAL_COOLDOWN: "Cool Down",
      INTERVAL_ACTIVE: "Run",
      INTERVAL_RECOVERY: "Recover",
      INTERVAL_REST: "Recover",
    })[type as "INTERVAL_ACTIVE"];
  return steps.map((s) => {
    const expected = steps.filter((x) => x.name === s.name),
      observed = groups.filter((g) => role(g.splitType) === s.name);
    const row: ReviewStep = {
      name: s.name,
      plannedMeters: stepMeters(s, snapshot.easyPace),
      target: s.target,
      recordedMeters: null,
      averageHr: null,
      averagePace: null,
      state: "unknown",
      note: "Individual step execution is unknown without an unambiguous recorded split.",
    };
    if (
      snapshot.workout!.type === "strides" &&
      s.name === "Run" &&
      row.plannedMeters <= 200
    ) {
      row.note =
        "Stride quality is not judged by HR. Short accelerations and lap-average pace do not establish smooth, relaxed execution.";
      return row;
    }
    if (
      expected.length !== 1 ||
      observed.length !== 1 ||
      observed[0].noOfSplits !== 1
    )
      return row;
    const g = observed[0];
    row.recordedMeters = g.distance;
    row.averageHr = g.averageHR;
    row.averagePace =
      g.averageSpeed && g.averageSpeed > 0
        ? 1000 / g.averageSpeed
        : g.distance && g.duration
          ? g.duration / (g.distance / 1000)
          : null;
    row.note =
      "A single Garmin split summary matches this step role. Averages cannot establish time spent within the target.";
    if (
      g.distance === null ||
      Math.abs(g.distance - row.plannedMeters) >
        Math.max(30, row.plannedMeters * 0.05)
    ) {
      row.state = "distance_differs";
      row.note =
        "Recorded split distance does not closely match this step; intensity compliance remains uncertain.";
      return row;
    }
    if (s.target.kind === "effort") {
      row.state = "effort_only";
      row.note =
        "Garmin averages cannot verify perceived effort; optional feedback adds context.";
      return row;
    }
    const value = s.target.kind === "hr" ? g.averageHR : row.averagePace;
    if (value === null) return row;
    row.state =
      value >= s.target.min && value <= s.target.max
        ? "average_inside"
        : "average_outside";
    return row;
  });
}
export function workoutReviews(db: Database.Database, now = new Date()) {
  const today = calendarDate(now),
    snapshots = prescriptionSnapshots(db),
    activities = new GarminRepository(db)
      .allActivities()
      .filter(
        (a) =>
          Date.parse(a.startedAt) <= now.getTime() &&
          calendarDate(new Date(a.startedAt)) >= shiftDay(today, -90) &&
          sportGroup(a) === "running",
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 100);
  const links = prepare(
    db,
    "SELECT activity_id,snapshot_id FROM activity_prescription_links",
  ).all() as { activity_id: string; snapshot_id: string | null }[];
  const feedback = prepare(
    db,
    "SELECT activity_id,feeling FROM activity_feedback",
  ).all() as { activity_id: string; feeling: SessionFeeling }[];
  const details = prepare(
    db,
    "SELECT activity_id,activity_fingerprint,status,summary_json,workouts_json FROM activity_details",
  ).all() as {
    activity_id: string;
    activity_fingerprint: string;
    status: string;
    summary_json: string | null;
    workouts_json: string | null;
  }[];
  const candidates = new Map<string, PrescriptionSnapshot[]>();
  for (const a of activities) {
    const day = calendarDate(new Date(a.startedAt)),
      latest = new Map<string, PrescriptionSnapshot>();
    for (const s of snapshots)
      if (s.capturedAt <= a.startedAt) latest.set(s.sessionKey, s);
    candidates.set(
      a.id,
      [...latest.values()].filter(
        (s) =>
          s.workout &&
          s.day === day &&
          ((!s.workout.trail && s.workout.race?.terrain !== "trail") ||
            a.sportType === "trail_running") &&
          countedActivityKm(a) > 0,
      ),
    );
  }
  const reviews: WorkoutReview[] = activities.map((a) => {
    const day = calendarDate(new Date(a.startedAt)),
      manual = links.find((l) => l.activity_id === a.id),
      matches = candidates.get(a.id) ?? [];
    const available = matches.filter(
      (s) =>
        !links.some(
          (l) =>
            l.activity_id !== a.id &&
            snapshots.some(
              (x) => x.id === l.snapshot_id && x.sessionKey === s.sessionKey,
            ),
        ) &&
        !activities.some(
          (other) =>
            other.id !== a.id &&
            !links.some((l) => l.activity_id === other.id) &&
            (candidates.get(other.id) ?? []).some(
              (x) => x.sessionKey === s.sessionKey,
            ),
        ),
    );
    const choices = snapshots.filter(
      (s) =>
        s.workout &&
        Math.abs((Date.parse(s.day) - Date.parse(day)) / 86400000) <= 7,
    );
    const suggestion =
      [...choices]
        .filter((s) => s.day === day)
        .sort(
          (left, right) =>
            Number(right.capturedAt <= a.startedAt) -
              Number(left.capturedAt <= a.startedAt) ||
            right.sequence - left.sequence,
        )[0] ?? null;
    const chosen =
      countedActivityKm(a) === 0
        ? null
        : manual?.snapshot_id
          ? (snapshots.find((s) => s.id === manual.snapshot_id) ?? null)
          : manual
            ? null
            : available.length === 1
              ? available[0]
              : suggestion;
    const match: WorkoutReview["match"] =
      countedActivityKm(a) === 0
        ? "unplanned"
        : manual
          ? manual.snapshot_id
            ? "manual"
            : "unplanned"
          : available.length === 1
            ? "automatic"
            : matches.length > 1 || (matches.length === 1 && !available.length)
              ? "ambiguous"
              : chosen
                ? "suggested"
                : "unplanned";
    const snapshot = chosen?.workout ? chosen : null,
      confirmed = match === "automatic" || match === "manual",
      plannedKm = snapshot?.workout
        ? workoutMileageKm(snapshot.workout, snapshot.easyPace)
        : null,
      counted = countedActivityKm(a);
    const stored = details.find((d) => d.activity_id === a.id),
      fresh = stored?.activity_fingerprint === activityReviewFingerprint(a),
      detail: ReviewDetail | null =
        stored && fresh && stored.status !== "loading"
          ? {
              activityFingerprint: stored.activity_fingerprint,
              status: stored.status,
              summary: stored.summary_json
                ? JSON.parse(stored.summary_json)
                : null,
              workouts: stored.workouts_json
                ? JSON.parse(stored.workouts_json)
                : null,
            }
          : null;
    const atStart = snapshot
      ? snapshots
          .filter(
            (s) =>
              s.sessionKey === snapshot.sessionKey &&
              s.capturedAt <= a.startedAt,
          )
          .at(-1)
      : null;
    const versionKnown = !!snapshot && atStart?.id === snapshot.id;
    return {
      activityId: a.id,
      day,
      name: a.name ?? "Recorded run",
      km: (a.distanceMeters ?? 0) / 1000,
      countedKm: counted,
      minutes: (a.durationSeconds ?? 0) / 60,
      averageHr: a.averageHeartRate,
      match,
      snapshot,
      plannedKm,
      distanceStatus:
        !confirmed || plannedKm === null
          ? "unknown"
          : counted < plannedKm * 0.9
            ? "partial"
            : counted > plannedKm * 1.1
              ? "over"
              : "met",
      versionKnown,
      feeling: feedback.find((f) => f.activity_id === a.id)?.feeling ?? null,
      detailStatus: stored && !fresh ? "stale" : (stored?.status ?? "pending"),
      attachedWorkout: !!detail?.workouts?.length,
      steps: confirmed && snapshot ? stepReview(snapshot, detail) : [],
      notes: [
        ...(!versionKnown && snapshot
          ? [
              "This selected prescription was captured later or was not the latest version at activity start. Its historical approved version is unverified.",
            ]
          : []),
        ...(!confirmed
          ? [
              "Confirm a prescription match before interpreting planned versus completed steps.",
            ]
          : []),
        ...(confirmed
          ? [
              "Distance matching does not establish that the full prescribed workout was completed.",
            ]
          : []),
        ...(detail?.summary?.splitSummaries.some((s) => (s.noOfSplits ?? 0) > 1)
          ? [
              "Garmin grouped multiple splits; individual intervals and time in target remain unknown.",
            ]
          : []),
        ...(a.excludedRaceMeters
          ? [
              "Race extras remain physical load but are excluded from counted milestone distance.",
            ]
          : []),
      ],
      choices: choices.slice(-100).reverse(),
      manualChoice: !!manual,
    };
  });
  const revision = snapshotSignature({
    snapshots: snapshots.map((s) => [s.id, s.signature]),
    activities: activities.map((a) => [
      a.id,
      activityReviewFingerprint(a),
      a.excludedRaceMeters ?? 0,
    ]),
    links,
  });
  return { revision, reviews };
}
export function saveWorkoutReview(
  db: Database.Database,
  input: unknown,
  now = new Date(),
) {
  const v = reviewInput.parse(input);
  return db
    .transaction(() => {
      const current = workoutReviews(db, now),
        review = current.reviews.find((r) => r.activityId === v.activityId);
      if (!review)
        throw new WorkoutReviewError(
          "Choose a recorded dedicated run within the last 90 days.",
        );
      if (v.action === "feedback") {
        if (v.feeling === null)
          prepare(db, "DELETE FROM activity_feedback WHERE activity_id=?").run(
            v.activityId,
          );
        else
          prepare(
            db,
            "INSERT INTO activity_feedback(activity_id,feeling,updated_at) VALUES(?,?,?) ON CONFLICT(activity_id) DO UPDATE SET feeling=excluded.feeling,updated_at=excluded.updated_at",
          ).run(v.activityId, v.feeling, now.toISOString());
        return;
      }
      if (v.revision !== current.revision)
        throw new WorkoutReviewError(
          "Training data changed. Refresh the match before saving.",
          409,
        );
      if (v.action === "automatic") {
        prepare(
          db,
          "DELETE FROM activity_prescription_links WHERE activity_id=?",
        ).run(v.activityId);
        return;
      }
      if (v.snapshotId) {
        if (review.countedKm === 0)
          throw new WorkoutReviewError(
            "A recording classified entirely as race extras cannot complete a running prescription.",
          );
        if (!review.choices.some((s) => s.id === v.snapshotId))
          throw new WorkoutReviewError(
            "Choose an existing prescription within seven days of this recording.",
          );
        if (
          prepare(
            db,
            "SELECT l.activity_id FROM activity_prescription_links l JOIN workout_prescriptions p ON p.id=l.snapshot_id WHERE p.session_key=(SELECT session_key FROM workout_prescriptions WHERE id=?) AND l.activity_id<>?",
          ).get(v.snapshotId, v.activityId)
        )
          throw new WorkoutReviewError(
            "That prescription is already linked to another recording.",
            409,
          );
      }
      prepare(
        db,
        "INSERT INTO activity_prescription_links(activity_id,snapshot_id,updated_at) VALUES(?,?,?) ON CONFLICT(activity_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,updated_at=excluded.updated_at",
      ).run(v.activityId, v.snapshotId, now.toISOString());
    })
    .immediate();
}
export function workoutReviewSummary(
  db: Database.Database,
  now = new Date(),
  start?: string,
) {
  const from = start ?? shiftDay(calendarDate(now), -14),
    until = start ? shiftDay(start, 7) : shiftDay(calendarDate(now), 1),
    all = workoutReviews(db, now).reviews.filter(
      (r) => r.day >= from && r.day < until,
    ),
    matched = all.filter(
      (r) => r.match === "automatic" || r.match === "manual",
    );
  return {
    runs: all.length,
    matched: matched.length,
    needsMatch: all.filter(
      (r) => r.match === "ambiguous" || r.match === "suggested",
    ).length,
    distanceMet: matched.filter(
      (r) => r.distanceStatus === "met" || r.distanceStatus === "over",
    ).length,
    partial: matched.filter((r) => r.distanceStatus === "partial").length,
    intensityUnknown: matched.filter(
      (r) =>
        !r.versionKnown ||
        !r.steps.length ||
        r.steps.some((s) => s.state === "unknown" || s.state === "effort_only"),
    ).length,
    averagesOutside: matched.filter(
      (r) =>
        r.versionKnown && r.steps.some((s) => s.state === "average_outside"),
    ).length,
    easier: all.filter((r) => r.feeling === "easier").length,
    right: all.filter((r) => r.feeling === "right").length,
    harder: all.filter((r) => r.feeling === "harder").length,
  };
}
