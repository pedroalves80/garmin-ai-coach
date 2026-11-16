import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/server/db/migrate";
import {
  recordPrescriptionCalendar,
  prescriptionSnapshots,
} from "../src/server/training/prescription-snapshots";
import {
  workoutReviews,
  saveWorkoutReview,
  workoutReviewSummary,
  activityReviewFingerprint,
} from "../src/server/training/workout-reviews";
import {
  fitnessEvidence,
  saveFitnessEvidence,
  fitnessEvidenceSummary,
} from "../src/server/training/fitness-evidence";
import {
  captureExistingPrescriptions,
  captureUpcomingWorkouts,
} from "../src/server/training/review-capture";
import { TrainingRepository } from "../src/server/training/repository";
import { GarminRepository } from "../src/server/db/garmin-repository";
import { enrichActivityDetails } from "../src/server/garmin/activity-details";
import { GarminClient } from "../src/server/garmin/client";
import { createTrainingPlan } from "../src/shared/training-plan";
import type { RunWorkout } from "../src/shared/types/metrics";
import type { WeekSchedule } from "../src/shared/types/schedule";
const now = new Date("2026-11-16T18:00:00Z"),
  before = new Date("2026-11-15T09:00:00Z");
function db() {
  const d = new Database(":memory:");
  d.pragma("foreign_keys=ON");
  migrateDatabase(d);
  migrateDatabase(d);
  return d;
}
function workout(km = 6): RunWorkout {
  return {
    dayOffset: 0,
    title: "Base run",
    type: "base",
    steps: [
      {
        kind: "step",
        name: "Warm Up",
        amount: { kind: "distance", meters: 500 },
        target: { kind: "hr", min: 125, max: 140 },
      },
      {
        kind: "step",
        name: "Run",
        amount: { kind: "distance", meters: (km - 1) * 1000 },
        target: { kind: "hr", min: 135, max: 148 },
      },
      {
        kind: "step",
        name: "Cool Down",
        amount: { kind: "distance", meters: 500 },
        target: { kind: "hr", min: 125, max: 140 },
      },
    ],
  };
}
function calendar(
  w: RunWorkout | null = workout(),
  day = "2026-11-16",
): WeekSchedule {
  return {
    start: "2026-11-16",
    days: [
      {
        day,
        dayOffset: 0,
        sessions: w
          ? [
              {
                status: "planned",
                session: {
                  id: "stable-run",
                  sport: "running",
                  slot: "lunch",
                  workout: w,
                },
              },
            ]
          : [],
        recorded: [],
        warnings: [],
      },
    ],
  };
}
function activity(
  d: Database.Database,
  id = "1",
  at = "2026-11-16T12:00:00.000Z",
  sport = "running",
  distance = 6000,
) {
  d.prepare("INSERT INTO activities VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
    `garmin:${id}`,
    id,
    sport,
    "Synthetic run",
    at,
    2200,
    distance,
    145,
    165,
    "{}",
    now.toISOString(),
  );
  return `garmin:${id}`;
}
function detail(d: Database.Database, id: string, splits: unknown[]) {
  const a = new GarminRepository(d).allActivities().find((x) => x.id === id)!;
  d.prepare(
    "INSERT OR REPLACE INTO activity_details VALUES(?,?,?,?,?,?,?)",
  ).run(
    id,
    activityReviewFingerprint(a),
    JSON.stringify({ splitSummaries: splits }),
    JSON.stringify([{ sport: "running", stepCount: 3 }]),
    now.toISOString(),
    "ready",
    "2027-01-01T00:00:00Z",
  );
}
const split = (
  splitType: string,
  distance: number,
  averageHR = 140,
  noOfSplits = 1,
) => ({
  splitType,
  distance,
  duration: distance * 0.36,
  averageHR,
  averageSpeed: 2.78,
  noOfSplits,
});
test("activity uses the version at its start; later edits and tombstones never rewrite it", () => {
  const d = db();
  try {
    recordPrescriptionCalendar(d, calendar(), 360, before, "approved");
    const old = prescriptionSnapshots(d)[0];
    activity(d);
    recordPrescriptionCalendar(d, calendar(workout(7)), 360, now);
    let r = workoutReviews(d, now).reviews[0];
    assert.equal(r.snapshot?.id, old.id);
    assert.equal(r.plannedKm, 6);
    assert.equal(r.versionKnown, true);
    assert.equal(r.match, "automatic");
    recordPrescriptionCalendar(d, calendar(null), 360, now);
    r = workoutReviews(d, now).reviews[0];
    assert.equal(r.snapshot?.id, old.id);
    assert.equal(prescriptionSnapshots(d).length, 3);
    assert.equal(workoutReviewSummary(d, now).distanceMet, 1);
  } finally {
    d.close();
  }
});
test("moved prescriptions keep their stable key; deleted runs and superseded manual versions stay uncertain", () => {
  const d = db();
  try {
    recordPrescriptionCalendar(d, calendar(), 360, before);
    const old = prescriptionSnapshots(d)[0];
    const moved = calendar(workout(), "2026-11-17");
    moved.days.push({ ...calendar(null).days[0] });
    recordPrescriptionCalendar(d, moved, 360, new Date("2026-11-16T09:00:00Z"));
    const id = activity(d);
    let data = workoutReviews(d, now);
    assert.notEqual(data.reviews[0].match, "automatic");
    saveWorkoutReview(
      d,
      {
        action: "link",
        activityId: id,
        snapshotId: old.id,
        revision: data.revision,
      },
      now,
    );
    assert.equal(workoutReviews(d, now).reviews[0].versionKnown, false);
    recordPrescriptionCalendar(
      d,
      calendar(),
      360,
      new Date("2026-11-17T09:00:00Z"),
    );
    assert.equal(prescriptionSnapshots(d).at(-1)?.day, "2026-11-16");
    data = workoutReviews(d, now);
    assert.equal(data.reviews[0].versionKnown, false);
  } finally {
    d.close();
  }
});
test("legacy history is suggested, never backdated; bootstrap and unchanged captures are idempotent", () => {
  const d = db();
  try {
    new TrainingRepository(d).savePlan(createTrainingPlan(1, "2026-11-09"));
    activity(d, "1", "2026-11-09T12:00:00.000Z");
    captureExistingPrescriptions(d, now);
    const snapshots = prescriptionSnapshots(d);
    assert(snapshots.length > 0);
    assert(
      snapshots.every(
        (s) => s.source === "legacy" && s.capturedAt === now.toISOString(),
      ),
    );
    captureExistingPrescriptions(d, now);
    captureUpcomingWorkouts(d, now);
    assert.equal(prescriptionSnapshots(d).length, snapshots.length);
    const r = workoutReviews(d, now).reviews[0];
    assert.equal(r.match, "suggested");
    assert.equal(r.versionKnown, false);
  } finally {
    d.close();
  }
});
test("ambiguous duplicate recordings require a choice; manual reservations prevent double use and stale writes", () => {
  const d = db();
  try {
    recordPrescriptionCalendar(d, calendar(), 360, before);
    const first = activity(d),
      second = activity(d, "2", "2026-11-16T13:00:00.000Z");
    let data = workoutReviews(d, now);
    assert(data.reviews.every((r) => r.match === "ambiguous"));
    const id = prescriptionSnapshots(d)[0].id;
    saveWorkoutReview(
      d,
      {
        action: "link",
        activityId: first,
        snapshotId: id,
        revision: data.revision,
      },
      now,
    );
    assert.throws(
      () =>
        saveWorkoutReview(
          d,
          {
            action: "link",
            activityId: second,
            snapshotId: id,
            revision: data.revision,
          },
          now,
        ),
      /changed/,
    );
    data = workoutReviews(d, now);
    assert.throws(
      () =>
        saveWorkoutReview(
          d,
          {
            action: "link",
            activityId: second,
            snapshotId: id,
            revision: data.revision,
          },
          now,
        ),
      /already linked/,
    );
    saveWorkoutReview(
      d,
      {
        action: "link",
        activityId: second,
        snapshotId: null,
        revision: data.revision,
      },
      now,
    );
    assert.equal(workoutReviewSummary(d, now).matched, 1);
    saveWorkoutReview(
      d,
      {
        action: "automatic",
        activityId: first,
        revision: workoutReviews(d, now).revision,
      },
      now,
    );
    assert.equal(
      workoutReviews(d, now).reviews.find((r) => r.activityId === first)?.match,
      "automatic",
    );
  } finally {
    d.close();
  }
});
test("optional feedback clears without inventing RPE, health reports or changing an approved plan", () => {
  const d = db();
  try {
    const id = activity(d);
    const initial = JSON.stringify(new TrainingRepository(d).plans());
    saveWorkoutReview(
      d,
      { action: "feedback", activityId: id, feeling: "harder" },
      now,
    );
    assert.equal(workoutReviewSummary(d, now).harder, 1);
    assert.equal(
      d
        .prepare<[], { n: number }>("SELECT count(*) n FROM session_efforts")
        .get()!.n,
      0,
    );
    assert.equal(
      d
        .prepare<[], { n: number }>("SELECT count(*) n FROM daily_check_ins")
        .get()!.n,
      0,
    );
    assert.equal(JSON.stringify(new TrainingRepository(d).plans()), initial);
    saveWorkoutReview(
      d,
      { action: "feedback", activityId: id, feeling: null },
      now,
    );
    assert.equal(workoutReviewSummary(d, now).harder, 0);
  } finally {
    d.close();
  }
});
test("only single role splits compare averages; no interval completion or time-in-zone is invented", () => {
  const d = db();
  try {
    recordPrescriptionCalendar(d, calendar(), 360, before);
    const id = activity(d);
    detail(d, id, [
      split("INTERVAL_WARMUP", 500, 135),
      split("INTERVAL_ACTIVE", 5000, 152),
      split("INTERVAL_COOLDOWN", 500, 130),
    ]);
    let r = workoutReviews(d, now).reviews[0];
    assert.equal(r.steps[1].state, "average_outside");
    assert.match(r.steps[1].note, /cannot establish time/);
    assert.equal(r.attachedWorkout, true);
    assert.equal(workoutReviewSummary(d, now).averagesOutside, 1);
    detail(d, id, [split("INTERVAL_ACTIVE", 5000, 145, 2)]);
    r = workoutReviews(d, now).reviews[0];
    assert.equal(r.steps[1].state, "unknown");
    assert(r.notes.some((n) => n.includes("grouped")));
    d.prepare("UPDATE activities SET distance_meters=6100").run();
    r = workoutReviews(d, now).reviews[0];
    assert.equal(r.detailStatus, "stale");
    assert(r.steps.every((s) => s.state === "unknown"));
  } finally {
    d.close();
  }
});
test("strides ignore HR, grouped repetitions remain unknown, trail effort is not measured from averages", () => {
  const d = db();
  try {
    const w = workout();
    w.type = "strides";
    w.steps.splice(1, 1, {
      kind: "repeat",
      times: 6,
      steps: [
        {
          kind: "step",
          name: "Run",
          amount: { kind: "distance", meters: 80 },
          target: { kind: "pace", min: 240, max: 270 },
        },
        {
          kind: "step",
          name: "Recover",
          amount: { kind: "distance", meters: 250 },
          target: { kind: "pace", min: 375, max: 450 },
        },
      ],
    });
    recordPrescriptionCalendar(d, calendar(w), 360, before);
    const id = activity(d);
    detail(d, id, [
      split("INTERVAL_ACTIVE", 480, 175, 6),
      split("INTERVAL_RECOVERY", 1500, 130, 6),
    ]);
    let r = workoutReviews(d, now).reviews[0];
    assert(
      r.steps
        .filter((s) => s.name === "Run")
        .every(
          (s) => s.state === "unknown" && s.note.includes("not judged by HR"),
        ),
    );
    const trail = workout();
    trail.trail = { ascentM: 200, expectedMinutes: 70 };
    trail.steps[1] = {
      kind: "step",
      name: "Run",
      amount: { kind: "distance", meters: 5000 },
      target: { kind: "effort", min: 3, max: 4 },
    };
    recordPrescriptionCalendar(
      d,
      calendar(trail),
      360,
      new Date("2026-11-15T10:00:00Z"),
    );
    d.prepare("UPDATE activities SET sport_type='trail_running'").run();
    detail(d, id, [split("INTERVAL_ACTIVE", 5000, 155)]);
    r = workoutReviews(d, now).reviews[0];
    assert.equal(r.steps[1].state, "effort_only");
  } finally {
    d.close();
  }
});
test("Hyrox, future runs and race-only extras cannot complete prescriptions", () => {
  const d = db();
  try {
    recordPrescriptionCalendar(d, calendar(), 360, before);
    const id = activity(d);
    activity(d, "2", "2026-11-16T13:00:00.000Z", "hiit");
    activity(d, "3", "2026-11-17T13:00:00.000Z");
    let data = workoutReviews(d, now);
    assert.equal(data.reviews.length, 1);
    saveWorkoutReview(
      d,
      {
        action: "link",
        activityId: id,
        snapshotId: prescriptionSnapshots(d)[0].id,
        revision: data.revision,
      },
      now,
    );
    d.prepare("INSERT INTO activity_mileage VALUES(?,NULL,6000,?)").run(
      id,
      now.toISOString(),
    );
    data = workoutReviews(d, now);
    assert.equal(data.reviews[0].match, "unplanned");
    assert.equal(data.reviews[0].countedKm, 0);
    assert.equal(workoutReviewSummary(d, now).matched, 0);
  } finally {
    d.close();
  }
});
const threshold = {
  kind: "threshold",
  source: "garmin_estimate",
  observedOn: null,
  heartRate: 170,
  paceSeconds: 300,
  powerWatts: 300,
  wattsPerKg: 4,
  device: "Example watch",
  sensor: "Example HR sensor",
};
test("fitness evidence preserves unknown date and source; revisions, archive and restore retain history without calibrating targets", () => {
  const d = db();
  try {
    const id = saveFitnessEvidence(
      d,
      { action: "save", evidence: threshold },
      now,
    );
    assert.equal(
      saveFitnessEvidence(d, { action: "save", evidence: threshold }, now),
      id,
    );
    let rows = fitnessEvidence(d);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].observedOn, null);
    assert.equal(rows[0].reportedAt, now.toISOString());
    const second = saveFitnessEvidence(
      d,
      { action: "save", id, evidence: { ...threshold, heartRate: 169 } },
      new Date("2026-11-16T18:01:00Z"),
    );
    rows = fitnessEvidence(d);
    assert.equal(rows.length, 2);
    assert(rows.find((r) => r.id === id)?.archivedAt);
    assert.equal(fitnessEvidenceSummary(d).threshold?.hr, 169);
    saveFitnessEvidence(d, { action: "archive", id: second }, now);
    assert.equal(fitnessEvidenceSummary(d).threshold, null);
    saveFitnessEvidence(d, { action: "restore", id: second }, now);
    assert.equal(
      fitnessEvidenceSummary(d).threshold?.source,
      "garmin_estimate",
    );
    assert.equal(
      d
        .prepare<[], { n: number }>("SELECT count(*) n FROM athlete_profile")
        .get()!.n,
      0,
    );
    assert.equal(
      d
        .prepare<[], { n: number }>(
          "SELECT count(*) n FROM training_preferences",
        )
        .get()!.n,
      0,
    );
    assert.throws(
      () =>
        saveFitnessEvidence(
          d,
          {
            action: "save",
            evidence: { ...threshold, observedOn: "2026-11-17" },
          },
          now,
        ),
      /future/,
    );
    assert.throws(() =>
      saveFitnessEvidence(
        d,
        {
          action: "save",
          evidence: { ...threshold, kind: "base_observation" },
        },
        now,
      ),
    );
    assert.equal(fitnessEvidence(d).length, 2);
  } finally {
    d.close();
  }
});
test("detail enrichment is bounded, cached, sanitized and nonfatal on unsupported endpoints", async () => {
  const d = db();
  try {
    for (let i = 1; i <= 11; i++)
      activity(
        d,
        String(i),
        `2026-11-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
      );
    let calls = 0;
    const client = {
      activityDetail: async (id: string) => {
        calls++;
        return {
          activityId: id,
          secret: "private",
          splitSummaries: [
            { ...split("INTERVAL_ACTIVE", 6000), location: "private" },
          ],
        };
      },
      activityWorkouts: async () => [
        { sport: "running", steps: [{ notes: "private", latitude: 1 }] },
      ],
    };
    assert.equal((await enrichActivityDetails(d, client, now)).fetched, 8);
    assert.equal(calls, 8);
    assert.equal((await enrichActivityDetails(d, client, now)).fetched, 3);
    assert.equal((await enrichActivityDetails(d, client, now)).fetched, 0);
    const stored = d
      .prepare("SELECT summary_json,workouts_json FROM activity_details")
      .all();
    assert(!JSON.stringify(stored).includes("private"));
    const first = new GarminRepository(d).allActivities()[0];
    d.prepare("UPDATE activities SET distance_meters=6100 WHERE id=?").run(
      first.id,
    );
    await enrichActivityDetails(
      d,
      {
        activityDetail: async () => {
          throw Error("unsupported");
        },
        activityWorkouts: async () => {
          throw Error("unsupported");
        },
      },
      now,
    );
    const row = d
      .prepare(
        "SELECT status,summary_json FROM activity_details WHERE activity_id=?",
      )
      .get(first.id);
    assert.deepEqual(row, { status: "unavailable", summary_json: null });
    const controller = new AbortController();
    controller.abort();
    assert.equal(
      (await enrichActivityDetails(d, client, now, controller.signal)).fetched,
      0,
    );
  } finally {
    d.close();
  }
});
test("in-flight detail refresh never reuses stale averages; IDs cannot inject Garmin paths", async () => {
  const d = db();
  try {
    recordPrescriptionCalendar(d, calendar(), 360, before);
    const id = activity(d);
    detail(d, id, [split("INTERVAL_ACTIVE", 5000, 145)]);
    d.prepare("UPDATE activity_details SET status='loading'").run();
    const r = workoutReviews(d, now).reviews[0];
    assert.equal(r.detailStatus, "loading");
    assert(r.steps.every((s) => s.state === "unknown"));
    const c = new GarminClient("fixture", async () => {
      throw Error("must not fetch");
    });
    await assert.rejects(c.activityDetail("../secret"));
    await assert.rejects(c.activityWorkouts("1/query"));
  } finally {
    d.close();
  }
});

test("two recordings cannot both complete different versions of the same intended session", () => {
  const d = db();
  try {
    recordPrescriptionCalendar(d, calendar(), 360, before);
    const first = activity(d, "1", "2026-11-16T10:00:00.000Z");
    recordPrescriptionCalendar(
      d,
      calendar(workout(7)),
      360,
      new Date("2026-11-16T11:00:00Z"),
    );
    const second = activity(
      d,
      "2",
      "2026-11-16T12:00:00.000Z",
      "running",
      7000,
    );
    let data = workoutReviews(d, now);
    assert(data.reviews.every((r) => r.match === "ambiguous"));
    const versions = prescriptionSnapshots(d);
    saveWorkoutReview(
      d,
      {
        action: "link",
        activityId: first,
        snapshotId: versions[0].id,
        revision: data.revision,
      },
      now,
    );
    data = workoutReviews(d, now);
    assert.throws(
      () =>
        saveWorkoutReview(
          d,
          {
            action: "link",
            activityId: second,
            snapshotId: versions[1].id,
            revision: data.revision,
          },
          now,
        ),
      /already linked/,
    );
    assert.equal(workoutReviewSummary(d, now).matched, 1);
  } finally {
    d.close();
  }
});
