import { plannedMinutes, plannedEffort } from "../src/shared/planned-load";
import { garminWorkoutText } from "../src/shared/training-plan";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/server/db/migrate";
import { TrainingRepository } from "../src/server/training/repository";
import { ScheduleRepository } from "../src/server/training/schedule-repository";
import { CommitmentRepository } from "../src/server/training/commitment-repository";
import { AthleteRepository } from "../src/server/training/athlete-repository";
import { ScheduleEditingService } from "../src/server/training/rescheduling";
import { GET as getAdjustments } from "../src/app/api/training/adjustments/route";
import { createTrainingPlan, workoutKm } from "../src/shared/training-plan";
import { DEFAULT_WEEK_PREFERENCES } from "../src/shared/types/schedule";
import type { TrainingSession } from "../src/shared/types/schedule";
import type {
  ScheduleEdit,
  ScheduleEditCatalog,
  ScheduleEditPreview,
  TrainingSlot,
} from "../src/shared/types/rescheduling";

const NOW = new Date("2026-11-05T12:00:00Z");
const WEEK = "2026-11-02";
const THURSDAY = "2026-11-05";
const FRIDAY = "2026-11-06";
const SATURDAY = "2026-11-07";

function fixture(t: TestContext) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  migrateDatabase(db);
  const training = new TrainingRepository(db);
  const schedule = new ScheduleRepository(db);
  const generated = createTrainingPlan(1, WEEK);
  const plan = {
    ...generated,
    targetKm: 25,
    // Keep Friday free even if the generated template gains a Friday run.
    workouts: generated.workouts.filter((w) => w.dayOffset !== 4),
  };
  training.savePlan(plan);
  schedule.saveWeek(WEEK, {
    ...structuredClone(DEFAULT_WEEK_PREFERENCES),
    hyrox: { monday: "going", wednesday: "going", friday: "skipping" },
    cyclingDays: [4, 5],
    cycleWhenSkippingHyrox: false,
  });
  training.saveCheckIn({
    day: THURSDAY,
    fatigue: 2,
    soreness: 2,
    pain: 0,
    notes: "",
  });
  db.prepare(
    "INSERT INTO sync_state(provider,last_completed_at,updated_at) VALUES('garmin',?,?)",
  ).run(NOW.toISOString(), NOW.toISOString());
  return {
    db,
    training,
    schedule,
    plan,
    service: new ScheduleEditingService(db, NOW),
  };
}
type Fixture = ReturnType<typeof fixture>;

function day(catalog: ScheduleEditCatalog, date: string) {
  const result = catalog.days.find((d) => d.day === date);
  assert.ok(result, `Expected catalog date ${date}`);
  return result;
}
function session(
  catalog: ScheduleEditCatalog,
  date: string,
  sport: TrainingSession["sport"],
) {
  const result = day(catalog, date).sessions.find(
    (s) => s.session.sport === sport,
  );
  assert.ok(result, `Expected ${sport} on ${date}`);
  assert.ok(result.session.id, "Catalog sessions need a stable identity");
  return result.session;
}
function run(catalog: ScheduleEditCatalog, date: string) {
  const result = session(catalog, date, "running");
  assert.equal(result.sport, "running");
  assert.ok(result.sport === "running");
  return result;
}
function move(f: Fixture): Extract<ScheduleEdit, { action: "move" }> {
  return {
    action: "move",
    day: THURSDAY,
    sessionId: run(f.service.catalog(WEEK), THURSDAY).id!,
    toDay: FRIDAY,
    toSlot: "morning",
    reason: "unavailable",
  };
}
function apply(f: Fixture, request: ScheduleEdit) {
  const preview = f.service.preview(request);
  const result = f.service.apply(request, preview.revision);
  assert.equal(result.saved, true);
  return { preview, id: result.id };
}
function changedDay(preview: ScheduleEditPreview, date: string) {
  const result = preview.days.find((d) => d.day === date);
  assert.ok(result, `Expected preview date ${date}`);
  return result;
}
function record(f: Fixture, sport = "running", date = THURSDAY) {
  const id = randomUUID();
  f.db
    .prepare(
      "INSERT INTO activities(id,provider_activity_id,sport_type,started_at,duration_seconds,distance_meters,raw_json,imported_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      id,
      sport,
      `${date}T09:00:00Z`,
      2400,
      6000,
      "{}",
      NOW.toISOString(),
    );
  return id;
}
function rejectWithoutMutation(
  f: Fixture,
  action: () => unknown,
  message?: RegExp,
) {
  const before = f.db.serialize();
  if (message) assert.throws(action, message);
  else assert.throws(action);
  assert.deepEqual(f.db.serialize(), before, "Rejected changes must be atomic");
}

test("Thursday to Friday morning preserves prescription, kilometres, IDs and Friday cycling; warns about Saturday", (t) => {
  const f = fixture(t);
  const original = f.service.catalog(WEEK);
  const source = run(original, THURSDAY);
  const cycling = session(original, FRIDAY, "cycling");
  assert.ok(
    !day(original, FRIDAY).sessions.some((s) => s.session.sport === "running"),
  );
  const before = f.db.serialize();
  const request = move(f);
  const preview = f.service.preview(request);
  assert.deepEqual(f.db.serialize(), before, "Preview must not write anything");
  assert.deepEqual(f.service.catalog(WEEK), original);
  assert.deepEqual(
    f.service.preview(request),
    preview,
    "Unchanged previews are stable",
  );
  assert.ok(
    !changedDay(preview, THURSDAY).after.some(
      (s) => s.session.id === source.id,
    ),
  );
  const moved = changedDay(preview, FRIDAY).after.find(
    (s) => s.session.id === source.id,
  )?.session;
  assert.ok(moved?.sport === "running");
  assert.equal(moved.slot, "morning");
  assert.equal(moved.workout.dayOffset, 4);
  assert.deepEqual(moved.workout.steps, source.workout.steps);
  assert.equal(
    workoutKm(moved.workout, f.plan.easyPace),
    workoutKm(source.workout, f.plan.easyPace),
  );
  assert.deepEqual(
    changedDay(preview, FRIDAY).after.find((s) => s.session.id === cycling.id)
      ?.session,
    cycling,
  );
  assert.equal(preview.weeks.length, 1);
  assert.equal(preview.weeks[0].beforeKm, preview.weeks[0].afterKm);
  assert.ok(
    preview.warnings.some((w) => w.includes(FRIDAY) && w.includes(SATURDAY)),
    "Warn about Friday running before Saturday's key run",
  );
  const saved = f.service.apply(request, preview.revision);
  assert.equal(saved.saved, true);
  const current = new ScheduleEditingService(f.db, NOW).catalog(WEEK);
  assert.deepEqual(run(current, FRIDAY), moved);
  assert.deepEqual(session(current, FRIDAY, "cycling"), cycling);
  assert.deepEqual(day(current, SATURDAY), day(original, SATURDAY));
  assert.ok(current.history.some((h) => h.id === saved.id && h.canUndo));
});

test("undo restores the original calendar and absence of override rows", (t) => {
  const f = fixture(t);
  const original = f.service.catalog(WEEK);
  assert.deepEqual(f.schedule.changes(WEEK), []);
  const { id } = apply(f, move(f));
  assert.equal(f.schedule.changes(WEEK).length, 2);
  const request: ScheduleEdit = { action: "undo", id };
  const before = f.db.serialize();
  const preview = f.service.preview(request);
  assert.deepEqual(f.db.serialize(), before);
  f.service.apply(request, preview.revision);
  assert.deepEqual(
    f.schedule.changes(WEEK),
    [],
    "Undo must remove newly created override rows",
  );
  const restored = f.service.catalog(WEEK);
  assert.deepEqual(restored.days, original.days);
  const history = restored.history.find((h) => h.id === id);
  assert.ok(history?.undoneAt);
  assert.equal(history.canUndo, false);
  rejectWithoutMutation(f, () => f.service.preview(request), /undo|undone/i);
});

for (const action of ["move", "skip"] as const) {
  test(`recorded source activity prevents ${action} and leaves history intact`, (t) => {
    const f = fixture(t);
    const request = move(f);
    record(f);
    const edit: ScheduleEdit =
      action === "move"
        ? request
        : {
            action: "skip",
            day: request.day,
            sessionId: request.sessionId,
            reason: "other",
          };
    rejectWithoutMutation(
      f,
      () => f.service.preview(edit),
      /uncompleted|recorded|available/i,
    );
    assert.ok(
      day(f.service.catalog(WEEK), THURSDAY).recorded.some(
        (r) => r.sport === "running",
      ),
    );
  });
}

test("a recorded run on the destination prevents moving another run there", (t) => {
  const f = fixture(t);
  const request = move(f);
  const { id } = apply(f, request);
  record(f, "running", FRIDAY);
  f.service = new ScheduleEditingService(
    f.db,
    new Date("2026-11-06T14:00:00Z"),
  );
  // Advance to Friday so this is a recorded activity rather than future data.
  const friday = new ScheduleEditingService(
    f.db,
    new Date("2026-11-06T12:00:00Z"),
  );
  const saturday = run(friday.catalog(WEEK), SATURDAY);
  rejectWithoutMutation(
    f,
    () =>
      friday.preview({
        ...request,
        day: SATURDAY,
        sessionId: saturday.id,
        toDay: FRIDAY,
      }),
    /recorded|sport|workout/i,
  );
  assert.ok(
    friday.catalog(WEEK).history.some((h) => h.id === id && !h.canUndo),
  );
});

test("new activity on an affected date prevents undo without deleting the activity", (t) => {
  const f = fixture(t);
  const { id } = apply(f, move(f));
  record(f);
  const catalog = f.service.catalog(WEEK);
  assert.equal(catalog.history.find((h) => h.id === id)?.canUndo, false);
  rejectWithoutMutation(
    f,
    () => f.service.preview({ action: "undo", id }),
    /undo|activities|changed/i,
  );
  assert.equal(day(f.service.catalog(WEEK), THURSDAY).recorded.length, 1);
});

for (const change of ["activity", "check-in", "availability"] as const) {
  test(`apply rejects a preview made before a new ${change}`, (t) => {
    const f = fixture(t);
    const request = move(f);
    const preview = f.service.preview(request);
    if (change === "activity") record(f, "swimming", "2026-11-04");
    if (change === "check-in")
      f.training.saveCheckIn({
        day: THURSDAY,
        fatigue: 3,
        soreness: 2,
        pain: 0,
        notes: "Updated recovery",
      });
    if (change === "availability")
      apply(f, {
        action: "availability",
        day: SATURDAY,
        slots: ["morning"],
        reason: "other",
      });
    rejectWithoutMutation(
      f,
      () => f.service.apply(request, preview.revision),
      /changed|preview/i,
    );
    assert.notEqual(f.service.preview(request).revision, preview.revision);
  });
}

test("a preview revision is bound to its exact request", (t) => {
  const f = fixture(t);
  const request = move(f);
  const preview = f.service.preview(request);
  for (const other of [
    { ...request, toSlot: "lunch" as const },
    { ...request, reason: "tired" as const },
    {
      action: "skip" as const,
      day: request.day,
      sessionId: request.sessionId,
      reason: request.reason,
    },
  ])
    rejectWithoutMutation(
      f,
      () => f.service.apply(other, preview.revision),
      /changed|preview/i,
    );
});

test("Sunday and past dates cannot receive moved ordinary training", (t) => {
  const f = fixture(t);
  for (const toDay of ["2026-11-08", "2026-11-04"]) {
    rejectWithoutMutation(
      f,
      () => f.service.preview({ ...move(f), toDay }),
      /Sunday|past|upcoming|history/i,
    );
  }
});

test("two recorded workouts prevent a third workout even in a free morning slot", (t) => {
  const f = fixture(t);
  const cycling = session(f.service.catalog(WEEK), FRIDAY, "cycling");
  record(f, "swimming");
  record(f, "strength_training");
  rejectWithoutMutation(
    f,
    () =>
      f.service.preview({
        action: "move",
        day: FRIDAY,
        sessionId: cycling.id,
        toDay: THURSDAY,
        toSlot: "morning",
        reason: "other",
      }),
    /two|limit|workouts/i,
  );
});

test("weekday lunch duration cap blocks a long run that fits Saturday", (t) => {
  const f = fixture(t);
  f.training.savePlan({
    ...f.plan,
    workouts: f.plan.workouts.map((w) =>
      w.dayOffset === 5
        ? {
            ...w,
            steps: [
              {
                kind: "step" as const,
                name: "Run" as const,
                amount: { kind: "distance" as const, meters: 21000 },
                target: { kind: "hr" as const, min: 135, max: 150 },
              },
            ],
          }
        : w,
    ),
  });
  const source = run(f.service.catalog(WEEK), SATURDAY);
  rejectWithoutMutation(
    f,
    () =>
      f.service.preview({
        ...move(f),
        day: SATURDAY,
        sessionId: source.id,
        toSlot: "lunch",
      }),
    /two.hour|120|lunch/i,
  );
});

for (const commitment of ["pause", "race"] as const) {
  test(`${commitment} protects the destination from manual moves`, (t) => {
    const f = fixture(t);
    const request = move(f);
    const repo = new CommitmentRepository(f.db);
    if (commitment === "pause")
      repo.savePause({
        id: randomUUID(),
        start: FRIDAY,
        end: SATURDAY,
        reason: "travel",
        cancelled: false,
        resumeOn: null,
        returnReviewedAt: null,
        createdAt: NOW.toISOString(),
      });
    else
      repo.saveRace({
        id: randomUUID(),
        name: "Friday race",
        day: FRIDAY,
        startTime: "09:00",
        distanceKm: 10,
        terrain: "road",
        elevationGain: 0,
        expectedMinutes: 60,
        priority: "training",
        status: "planned",
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      });
    rejectWithoutMutation(
      f,
      () => f.service.preview(request),
      /race|break|recovery|rule|uncompleted|available/i,
    );
  });
}

test("race sessions themselves cannot be moved or skipped as ordinary training", (t) => {
  const f = fixture(t);
  new CommitmentRepository(f.db).saveRace({
    id: randomUUID(),
    name: "Saturday race",
    day: SATURDAY,
    startTime: null,
    distanceKm: 10,
    terrain: "road",
    elevationGain: null,
    expectedMinutes: 60,
    priority: "training",
    status: "planned",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  const race = run(f.service.catalog(WEEK), SATURDAY);
  for (const request of [
    {
      action: "move" as const,
      day: SATURDAY,
      sessionId: race.id!,
      toDay: FRIDAY,
      toSlot: "morning" as const,
      reason: "other" as const,
    },
    {
      action: "skip" as const,
      day: SATURDAY,
      sessionId: race.id!,
      reason: "other" as const,
    },
  ])
    rejectWithoutMutation(f, () => f.service.preview(request), /race|fixed/i);
});

test("an unavailable destination window blocks movement without blocking other windows", (t) => {
  const f = fixture(t);
  apply(f, {
    action: "availability",
    day: FRIDAY,
    slots: ["morning"],
    reason: "unavailable",
  });
  rejectWithoutMutation(f, () => f.service.preview(move(f)), /unavailable/i);
  const preview = f.service.preview({ ...move(f), toSlot: "lunch" });
  assert.ok(
    changedDay(preview, FRIDAY).after.some(
      (s) => s.session.sport === "running" && s.session.slot === "lunch",
    ),
  );
});

test("skip removes only the chosen session and never redistributes distance or changes the reviewed baseline", (t) => {
  const f = fixture(t);
  const original = f.service.catalog(WEEK);
  const source = run(original, THURSDAY);
  const savedPlans = f.training.plans();
  const request: ScheduleEdit = {
    action: "skip",
    day: THURSDAY,
    sessionId: source.id!,
    reason: "tired",
  };
  const { preview } = apply(f, request);
  assert.ok(
    !changedDay(preview, THURSDAY).after.some(
      (s) => s.session.id === source.id,
    ),
  );
  assert.ok(
    Math.abs(
      preview.weeks[0].beforeKm -
        preview.weeks[0].afterKm -
        workoutKm(source.workout, f.plan.easyPace),
    ) < 1e-8,
  );
  const current = f.service.catalog(WEEK);
  assert.deepEqual(
    current.days.filter((d) => d.day !== THURSDAY),
    original.days.filter((d) => d.day !== THURSDAY),
  );
  assert.deepEqual(f.training.plans(), savedPlans);
  assert.ok(
    preview.warnings.some((w) =>
      /not redistributed|not.*made up|no catch.up/i.test(w),
    ),
  );
});

for (const slots of [
  ["lunch"],
  ["morning", "lunch", "later"],
] as TrainingSlot[][]) {
  test(`${slots.length === 3 ? "whole-day" : "partial"} availability previews, records history, and undo restores availability and prescriptions`, (t) => {
    const f = fixture(t);
    f.schedule.saveWeek(WEEK, {
      ...f.schedule.week(WEEK),
      cyclingDays: [3, 4, 5],
    });
    const original = f.service.catalog(WEEK);
    const request: ScheduleEdit = {
      action: "availability",
      day: THURSDAY,
      slots,
      reason: "unavailable",
    };
    const before = f.db.serialize();
    const preview = f.service.preview(request);
    assert.deepEqual(f.db.serialize(), before);
    assert.deepEqual(changedDay(preview, THURSDAY).beforeUnavailable, []);
    assert.deepEqual(changedDay(preview, THURSDAY).afterUnavailable, slots);
    const { id } = apply(f, request);
    const current = f.service.catalog(WEEK);
    assert.deepEqual(
      current.availability.find((b) => b.day === THURSDAY)?.slots,
      slots,
    );
    assert.deepEqual(
      day(current, THURSDAY).sessions.map((s) => s.session.sport),
      slots.length === 3 ? [] : ["cycling"],
    );
    assert.deepEqual(day(current, FRIDAY), day(original, FRIDAY));
    const history = current.history.find((h) => h.id === id);
    assert.ok(history?.canUndo);
    assert.equal(history.reason, "unavailable");
    assert.deepEqual(history.days, [THURSDAY]);
    apply(f, { action: "undo", id });
    const restored = f.service.catalog(WEEK);
    assert.deepEqual(restored.availability, []);
    assert.deepEqual(restored.days, original.days);
    assert.deepEqual(f.schedule.changes(WEEK), []);
  });
}

test("availability replacement and clearing can each undo to the prior partial block", (t) => {
  const f = fixture(t);
  apply(f, {
    action: "availability",
    day: FRIDAY,
    slots: ["morning"],
    reason: "other",
  });
  const partial = f.service.catalog(WEEK);
  for (const slots of [["morning", "lunch", "later"], []] as TrainingSlot[][]) {
    const { id } = apply(f, {
      action: "availability",
      day: FRIDAY,
      slots,
      reason: "unavailable",
    });
    apply(f, { action: "undo", id });
    const restored = f.service.catalog(WEEK);
    assert.deepEqual(restored.availability, partial.availability);
    assert.deepEqual(restored.days, partial.days);
  }
});

test("availability never hides recorded activities or marks them uncompleted", (t) => {
  const f = fixture(t);
  record(f);
  apply(f, {
    action: "availability",
    day: THURSDAY,
    slots: ["morning", "lunch", "later"],
    reason: "other",
  });
  const current = day(f.service.catalog(WEEK), THURSDAY);
  assert.equal(current.recorded.length, 1);
  assert.ok(
    current.sessions.some(
      (s) => s.session.sport === "running" && s.status === "recorded",
    ),
  );
});

test("same-day time move keeps one session, its identity, steps and total kilometres", (t) => {
  const f = fixture(t);
  const original = f.service.catalog(WEEK);
  const source = run(original, THURSDAY);
  const { preview, id } = apply(f, { ...move(f), toDay: THURSDAY });
  assert.equal(preview.days.length, 1);
  const current = f.service.catalog(WEEK);
  const moved = run(current, THURSDAY);
  assert.equal(moved.id, source.id);
  assert.equal(moved.slot, "morning");
  assert.deepEqual(moved.workout, source.workout);
  assert.equal(
    day(current, THURSDAY).sessions.filter((s) => s.session.sport === "running")
      .length,
    1,
  );
  assert.equal(preview.weeks[0].beforeKm, preview.weeks[0].afterKm);
  apply(f, { action: "undo", id });
  assert.deepEqual(f.service.catalog(WEEK).days, original.days);
});

test("cross-week moves require a reviewed destination and respect its volume budget", (t) => {
  const f = fixture(t);
  // Use an ordinary base run so the rejection isolates distance, not key-session count.
  f.training.savePlan({
    ...f.plan,
    workouts: f.plan.workouts.map((w) =>
      w.dayOffset === 3 ? { ...w, type: "base" as const } : w,
    ),
  });
  const request = { ...move(f), toDay: "2026-11-11" };
  rejectWithoutMutation(f, () => f.service.preview(request), /reviewed|save/i);
  f.training.savePlan(createTrainingPlan(1, "2026-11-09"));
  rejectWithoutMutation(
    f,
    () => f.service.preview(request),
    /volume|kilometres|reviewed|swap/i,
  );
});

test("equal-distance cross-week swap preserves both budgets, session identities and secondary workouts", (t) => {
  const f = fixture(t);
  f.training.savePlan(createTrainingPlan(1, "2026-11-09"));
  const original = f.service.catalog(WEEK);
  const source = run(original, THURSDAY);
  const target = run(original, "2026-11-12");
  const request: ScheduleEdit = {
    action: "swap",
    day: THURSDAY,
    sessionId: source.id!,
    withDay: "2026-11-12",
    withSessionId: target.id!,
    reason: "other",
  };
  const { preview, id } = apply(f, request);
  assert.equal(preview.weeks.length, 2);
  for (const week of preview.weeks) assert.equal(week.beforeKm, week.afterKm);
  const current = f.service.catalog(WEEK);
  assert.equal(run(current, THURSDAY).id, target.id);
  assert.equal(run(current, "2026-11-12").id, source.id);
  assert.deepEqual(run(current, THURSDAY).workout.steps, target.workout.steps);
  assert.deepEqual(
    run(current, "2026-11-12").workout.steps,
    source.workout.steps,
  );
  for (const date of [THURSDAY, "2026-11-12"]) {
    assert.deepEqual(
      day(current, date).sessions.filter((s) => s.session.sport !== "running"),
      day(original, date).sessions.filter((s) => s.session.sport !== "running"),
    );
  }
  apply(f, { action: "undo", id });
  assert.deepEqual(f.service.catalog(WEEK).days, original.days);
});

test("legacy overrides without IDs receive a usable stable catalog identity", (t) => {
  const f = fixture(t);
  const original = run(f.service.catalog(WEEK), THURSDAY);
  f.schedule.saveChanges(
    [
      {
        day: THURSDAY,
        sessions: [
          {
            sport: "running",
            slot: "lunch",
            workout: original.workout,
          },
        ],
      },
    ],
    null,
  );
  const legacy = run(f.service.catalog(WEEK), THURSDAY);
  assert.equal(
    run(new ScheduleEditingService(f.db, NOW).catalog(WEEK), THURSDAY).id,
    legacy.id,
  );
  const { id } = apply(f, { ...move(f), sessionId: legacy.id! });
  assert.equal(run(f.service.catalog(WEEK), FRIDAY).id, legacy.id);
  apply(f, { action: "undo", id });
  assert.deepEqual(run(f.service.catalog(WEEK), THURSDAY), legacy);
});

test("suggest returns an applicable preview without writing or altering the prescription", (t) => {
  const f = fixture(t);
  const original = run(f.service.catalog(WEEK), THURSDAY);
  const before = f.db.serialize();
  const suggestion = f.service.suggest(THURSDAY, original.id!, "unavailable");
  assert.deepEqual(f.db.serialize(), before);
  assert.equal(suggestion.request.action, "move");
  assert.ok(suggestion.request.action === "move");
  assert.equal(suggestion.request.sessionId, original.id);
  assert.ok(suggestion.request.toDay > THURSDAY);
  const target = changedDay(suggestion, suggestion.request.toDay).after.find(
    (s) => s.session.id === original.id,
  )?.session;
  assert.ok(target?.sport === "running");
  assert.deepEqual(target.workout.steps, original.workout.steps);
  assert.equal(
    f.service.apply(suggestion.request, suggestion.revision).saved,
    true,
  );
});

for (const recovery of ["pain", "fatigue", "soreness"] as const) {
  test(`current ${recovery} blocks moving and restoring a skipped session but permits skipping`, (t) => {
    const f = fixture(t);
    const request = move(f);
    f.training.saveCheckIn({
      day: THURSDAY,
      fatigue: recovery === "fatigue" ? 4 : 2,
      soreness: recovery === "soreness" ? 4 : 2,
      pain: recovery === "pain" ? 1 : 0,
      notes: "",
    });
    rejectWithoutMutation(
      f,
      () => f.service.preview(request),
      /pain|fatigue|soreness|recovery/i,
    );
    const { id } = apply(f, {
      action: "skip",
      day: THURSDAY,
      sessionId: request.sessionId,
      reason: "tired",
    });
    // Recovery predates the skip: undo must validate the restoration itself.
    rejectWithoutMutation(
      f,
      () => f.service.preview({ action: "undo", id }),
      /recovery|restor|review/i,
    );
    assert.ok(
      !day(f.service.catalog(WEEK), THURSDAY).sessions.some(
        (s) => s.session.id === request.sessionId,
      ),
    );
  });
}

for (const change of ["check-in", "effort"] as const) {
  test(`new ${change} invalidates undo even when affected calendar dates are unchanged`, (t) => {
    const f = fixture(t);
    const activityId = record(f, "running", "2026-11-04");
    const { id } = apply(f, move(f));
    if (change === "check-in")
      f.training.saveCheckIn({
        day: THURSDAY,
        fatigue: 3,
        soreness: 2,
        pain: 0,
        notes: "Recovery changed",
      });
    else
      new AthleteRepository(f.db).saveEffort({
        activityId,
        rpe: 6,
        prescriptionCompleted: false,
      });
    assert.equal(
      f.service.catalog(WEEK).history.find((h) => h.id === id)?.canUndo,
      false,
    );
    rejectWithoutMutation(
      f,
      () => f.service.preview({ action: "undo", id }),
      /undo|changed/i,
    );
  });
}

for (const type of ["quality", "long", "strides"] as const) {
  test(`cross-week move cannot add another ${type} session even with distance headroom`, (t) => {
    const f = fixture(t);
    f.training.savePlan({
      ...f.plan,
      workouts: f.plan.workouts.map((w) =>
        w.dayOffset === 3 ? { ...w, type } : w,
      ),
    });
    const next = createTrainingPlan(1, "2026-11-09");
    f.training.savePlan({
      ...next,
      workouts: next.workouts.filter((w) => w.type === type),
    });
    const source = run(f.service.catalog(WEEK), THURSDAY);
    const plannedKm = f.training
      .plans()
      .find((p) => p.start === next.start)!
      .workouts.reduce((sum, w) => sum + workoutKm(w, next.easyPace), 0);
    assert.ok(
      plannedKm + workoutKm(source.workout, f.plan.easyPace) <= next.targetKm,
    );
    rejectWithoutMutation(
      f,
      () => f.service.preview({ ...move(f), toDay: "2026-11-11" }),
      /key|equivalent|review/i,
    );
  });
}

test("replacing either reviewed week is blocked until a cross-week move is undone", (t) => {
  const f = fixture(t);
  f.training.savePlan({
    ...f.plan,
    workouts: f.plan.workouts.map((w) =>
      w.dayOffset === 3 ? { ...w, type: "base" as const } : w,
    ),
  });
  const next = createTrainingPlan(1, "2026-11-09");
  // A base-only destination has room for another ordinary run.
  f.training.savePlan({
    ...next,
    workouts: next.workouts.filter((w) => w.type === "base"),
  });
  const plans = f.training.plans();
  const { id } = apply(f, { ...move(f), toDay: "2026-11-11" });
  for (const plan of plans) {
    rejectWithoutMutation(
      f,
      () => f.training.savePlan(plan, NOW),
      /undo|moved|another.*week|either.*week/i,
    );
  }
  apply(f, { action: "undo", id });
  for (const plan of plans) f.training.savePlan(plan, NOW);
  assert.deepEqual(f.training.plans(), plans);
});

test("catalog GET supports HTTP LAN browsers without Fetch Metadata and rejects foreign pages", async () => {
  // Invalid input stops after authorization, isolating this guard from the process-global DB.
  const url = "http://0.0.0.0:3000/api/training/adjustments?week=invalid";
  for (const host of [
    "localhost:3100",
    "raspberrypi.local:3000",
    "10.0.0.10:3100",
  ]) {
    for (const metadata of [
      {},
      { "sec-fetch-site": "same-origin" },
      { "sec-fetch-site": "none" },
    ] as Record<string, string>[]) {
      const headers = { host, "x-coach-request": "local", ...metadata };
      const response = await getAdjustments(new Request(url, { headers }));
      assert.equal(
        response.status,
        400,
        "Local browser reads must reach input validation",
      );
      assert.equal(response.headers.get("cache-control"), "no-store");
      for (const override of [
        { origin: "https://evil.example" },
        { origin: "null" },
        { "sec-fetch-site": "cross-site" },
        { "sec-fetch-site": "same-site" },
      ] as Record<string, string>[]) {
        const rejected = await getAdjustments(
          new Request(url, { headers: { ...headers, ...override } }),
        );
        assert.equal(rejected.status, 403);
      }
    }
    const noHeader = await getAdjustments(
      new Request(url, { headers: { host } }),
    );
    assert.equal(noHeader.status, 401);
  }
});

test("trail long run preview preserves all kilometres, supports road restore and guarded undo", (t) => {
  const f = fixture(t);
  const before = run(f.service.catalog(WEEK), SATURDAY);
  const change: ScheduleEdit = {
    action: "terrain",
    day: SATURDAY,
    sessionId: before.id!,
    terrain: "trail",
    expectedMinutes: 140,
    ascentM: 450,
    reason: "other",
  };
  const dbBefore = f.db.serialize();
  const preview = f.service.preview(change);
  assert.deepEqual(f.db.serialize(), dbBefore);
  assert.equal(preview.weeks[0].beforeKm, preview.weeks[0].afterKm);
  assert(preview.warnings.some((w) => w.includes("trail kilometres")));
  const result = f.service.apply(change, preview.revision);
  const trail = run(f.service.catalog(WEEK), SATURDAY);
  assert.equal(
    workoutKm(trail.workout, f.plan.easyPace),
    workoutKm(before.workout, f.plan.easyPace),
  );
  assert.equal(trail.workout.trail!.expectedMinutes, 140);
  assert.equal(trail.workout.trail!.ascentM, 450);
  assert.deepEqual(trail.workout.trail!.road!.steps, before.workout.steps);
  assert.equal(trail.id, before.id);
  assert.equal(day(f.service.catalog(WEEK), SATURDAY).sessions.length, 2);
  const text = garminWorkoutText(trail.workout);
  assert.match(text, /RPE 3–4\/10/);
  assert.doesNotMatch(text, /HR \d|Pace \d/);
  assert.equal(plannedMinutes(trail, f.plan), 140);
  assert.equal(plannedEffort(trail), 4);
  apply(f, {
    ...change,
    terrain: "road",
    expectedMinutes: undefined,
    ascentM: undefined,
  });
  assert.deepEqual(run(f.service.catalog(WEEK), SATURDAY), before);
  // A later change makes the first history entry unsafe to undo.
  assert.throws(
    () => f.service.preview({ action: "undo", id: result.id }),
    /Cannot undo/,
  );
});

test("trail edits undo cleanly, survive moves, and honour lunch duration and protected sessions", (t) => {
  const f = fixture(t);
  const before = run(f.service.catalog(WEEK), SATURDAY);
  const change: ScheduleEdit = {
    action: "terrain",
    day: SATURDAY,
    sessionId: before.id!,
    terrain: "trail",
    expectedMinutes: 150,
    reason: "other",
  };
  const first = apply(f, change);
  apply(f, { action: "undo", id: first.id });
  assert.deepEqual(run(f.service.catalog(WEEK), SATURDAY), before);
  apply(f, change);
  rejectWithoutMutation(
    f,
    () =>
      f.service.preview({
        action: "move",
        day: SATURDAY,
        sessionId: before.id!,
        toDay: FRIDAY,
        toSlot: "lunch",
        reason: "other",
      }),
    /two hours/,
  );
  apply(f, {
    action: "move",
    day: SATURDAY,
    sessionId: before.id!,
    toDay: FRIDAY,
    toSlot: "morning",
    reason: "other",
  });
  assert.equal(
    run(f.service.catalog(WEEK), FRIDAY).workout.trail!.expectedMinutes,
    150,
  );
  rejectWithoutMutation(
    f,
    () =>
      f.service.preview({
        ...change,
        day: THURSDAY,
        sessionId: run(f.service.catalog(WEEK), THURSDAY).id!,
      }),
    /long run/,
  );
  record(f, "running", FRIDAY);
  f.service = new ScheduleEditingService(
    f.db,
    new Date("2026-11-06T14:00:00Z"),
  );
  rejectWithoutMutation(
    f,
    () => f.service.preview({ ...change, day: FRIDAY }),
    /uncompleted/,
  );
});

test("trail inputs and stale previews cannot mutate a plan", (t) => {
  const f = fixture(t),
    id = run(f.service.catalog(WEEK), SATURDAY).id!;
  const change: ScheduleEdit = {
    action: "terrain",
    day: SATURDAY,
    sessionId: id,
    terrain: "trail",
    expectedMinutes: 100,
    reason: "other",
  };
  for (const patch of [
    { expectedMinutes: undefined },
    { expectedMinutes: 0 },
    { ascentM: -1 },
    { expectedMinutes: 40.5 },
  ])
    rejectWithoutMutation(f, () => f.service.preview({ ...change, ...patch }));
  const preview = f.service.preview(change);
  record(f, "cycling");
  rejectWithoutMutation(
    f,
    () => f.service.apply(change, preview.revision),
    /changed|stale|preview/i,
  );
});
