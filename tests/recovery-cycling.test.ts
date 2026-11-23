import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrateDatabase } from "../src/server/db/migrate";
import { TrainingRepository } from "../src/server/training/repository";
import { raceRecoveryEvidence } from "../src/server/training/race-recovery";
import { applyCommitments } from "../src/shared/commitment-calendar";
import { applyAvailability } from "../src/shared/schedule-editing";
import { createTrainingPlan } from "../src/shared/training-plan";
import { calendarMileage } from "../src/shared/mileage";
import { fitMileageWeek } from "../src/shared/fit-mileage-week";
import { DEFAULT_TARGETS } from "../src/shared/types/athlete";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_WEEK_PREFERENCES,
} from "../src/shared/types/schedule";
import type { RaceEvent, Commitments } from "../src/shared/types/commitments";
import type {
  WeekSchedule,
  WeekPreferences,
} from "../src/shared/types/schedule";
import {
  buildWeekSchedule,
  cyclingMinutes,
  powerRange,
  validateDaySessions,
} from "../src/shared/weekly-schedule";

const today = "2026-11-23";
const now = new Date(today + "T12:00:00Z");
const plan = { ...createTrainingPlan(4, today), planningVersion: 2 as const };
const race: RaceEvent = {
  id: "race",
  name: "Trail",
  day: "2026-11-22",
  startTime: null,
  distanceKm: 16,
  terrain: "trail",
  elevationGain: 650,
  expectedMinutes: 140,
  priority: "training",
  status: "planned",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  recorded: { activityId: "trail", km: 15.8, minutes: 135 },
};
const commitments: Commitments = { races: [race], pauses: [] };
type Options = Parameters<typeof applyCommitments>[4];
function project({
  week = DEFAULT_WEEK_PREFERENCES,
  c = commitments,
  options = {},
  records = [],
  ftp = 176,
}: {
  week?: WeekPreferences;
  c?: Commitments;
  options?: Partial<Options>;
  records?: Parameters<typeof buildWeekSchedule>[4];
  ftp?: number;
} = {}) {
  const raw = buildWeekSchedule(
    plan,
    week,
    { ...DEFAULT_PREFERENCES, ftpWatts: ftp, saturdayCyclingMinutes: 180 },
    [],
    records,
  );
  return {
    raw,
    result: applyCommitments(raw, plan, c, DEFAULT_TARGETS, {
      today,
      returnReady: true,
      raceRecovery: { stopRunning: false, reasons: [], cyclingAllowed: true },
      ...options,
    }),
  };
}
const rides = (c: WeekSchedule) =>
  c.days.flatMap((d) =>
    d.sessions
      .filter((s) => s.status === "planned" && s.session.sport === "cycling")
      .map((s) => ({ day: d, entry: s })),
  );
const runs = (c: WeekSchedule) =>
  c.days.map((d) => d.sessions.filter((s) => s.session.sport === "running"));

test("recorded trail recovery keeps two optional selected 60-minute rides without changing runs or input", () => {
  const { raw, result } = project();
  const before = JSON.stringify(raw);
  const without = project({
    options: {
      raceRecovery: { stopRunning: false, reasons: [], cyclingAllowed: false },
    },
  }).result;
  assert.deepEqual(
    rides(result).map((r) => r.day.dayOffset),
    [3, 5],
  );
  assert.deepEqual(runs(result), runs(without));
  assert.equal(
    calendarMileage(result, plan.easyPace).countedKm,
    calendarMileage(without, plan.easyPace).countedKm,
  );
  assert.equal(JSON.stringify(raw), before);
  assert.equal(result.days[0].sessions.length, 0);
  assert.equal(result.days[1].sessions.length, 0);
  assert.equal(result.days[6].sessions.length, 0);
  assert(
    result.days.every((d) =>
      d.sessions.every((s) => s.session.sport !== "hyrox"),
    ),
  );
  for (const { day, entry } of rides(result)) {
    assert.equal(entry.session.sport, "cycling");
    if (entry.session.sport !== "cycling") continue;
    assert.equal(entry.session.workout.title, "Optional recovery cycling");
    assert.equal(entry.session.workout.effort, "recovery");
    assert.equal(cyclingMinutes(entry.session.workout), 60);
    assert.deepEqual(
      entry.session.workout.steps.map((s) => s.minutes),
      [5, 50, 5],
    );
    assert.deepEqual(
      entry.session.workout.steps.map((s) => [s.minPercent, s.maxPercent]),
      [
        [40, 50],
        [45, 55],
        [35, 45],
      ],
    );
    assert(day.rule?.notes.some((n) => n.includes("skip rather than extend")));
    validateDaySessions(
      day.dayOffset,
      day.sessions.map((s) => s.session),
      plan.easyPace,
    );
  }
  const fit = fitMileageWeek(result, plan, commitments, {
    today,
    longestRecentKm: 16,
  });
  assert.equal(calendarMileage(fit.calendar, plan.easyPace).countedKm, 23);
  assert.equal(rides(fit.calendar).length, 2);
});

test("cycling follows chosen days, skipping Hyrox and edited FTP, never creates unselected rides", () => {
  const week: WeekPreferences = {
    hyrox: { monday: "skipping", wednesday: "going", friday: "skipping" },
    cyclingDays: [3, 5],
    cycleWhenSkippingHyrox: true,
  };
  const cal = project({ week, ftp: 200 }).result;
  assert.deepEqual(
    rides(cal).map((r) => r.day.dayOffset),
    [3, 5],
  );
  assert(
    rides(cal).every(
      ({ entry }) =>
        entry.session.sport === "cycling" &&
        entry.session.workout.ftpWatts === 200,
    ),
  );
  assert.deepEqual(powerRange(200, 45, 55), { min: 90, max: 110 });
  const onlyFriday = project({ week: { ...week, cyclingDays: [] } }).result;
  assert.deepEqual(
    rides(onlyFriday).map((r) => r.day.dayOffset),
    [4],
  );
  const none = project({
    week: {
      ...DEFAULT_WEEK_PREFERENCES,
      cyclingDays: [],
      cycleWhenSkippingHyrox: false,
    },
  }).result;
  assert.equal(rides(none).length, 0);
});

test("initial rest, historical dates, missing recording, major events and new concerns withhold cycling", () => {
  const allDays: WeekPreferences = {
    hyrox: { monday: "skipping", wednesday: "skipping", friday: "skipping" },
    cyclingDays: [0, 1, 2, 3, 4, 5],
    cycleWhenSkippingHyrox: true,
  };
  assert.deepEqual(
    rides(project({ week: allDays }).result).map((r) => r.day.dayOffset),
    [2, 4],
  );
  const noRecording = { ...race };
  delete noRecording.recorded;
  const cases = [
    project({ c: { races: [noRecording], pauses: [] } }),
    project({ c: { races: [{ ...race, distanceKm: 42 }], pauses: [] } }),
    project({
      c: {
        races: [{ ...race, recorded: { ...race.recorded!, minutes: 240 } }],
        pauses: [],
      },
    }),
    project({
      options: {
        raceRecovery: {
          stopRunning: true,
          reasons: ["pain"],
          cyclingAllowed: true,
        },
      },
    }),
    project({
      options: {
        raceRecovery: {
          stopRunning: false,
          reasons: ["sleep flag"],
          cyclingAllowed: true,
        },
      },
    }),
    project({ options: { raceRecovery: { stopRunning: false, reasons: [] } } }),
    project({ options: { today: "2026-11-29" } }),
  ];
  for (const { result } of cases) assert.equal(rides(result).length, 0);
  const future = project({
    c: { races: [noRecording], pauses: [] },
    options: { today: "2026-11-20", raceRecovery: undefined },
  }).result;
  assert.equal(rides(future).length, 2);
  assert(rides(future).every((r) => r.day.rule?.provisional));
});

test("breaks, return phases, approved rest, availability and nearby race preparation win", () => {
  const pause = {
    id: "pause",
    start: today,
    end: "2026-11-29",
    reason: "rest" as const,
    cancelled: false,
    resumeOn: null,
    returnReviewedAt: null,
    createdAt: now.toISOString(),
  };
  for (const p of [
    pause,
    {
      ...pause,
      end: "2026-11-22",
      start: "2026-11-20",
      returnReviewedAt: today,
    },
    {
      ...pause,
      end: "2026-11-22",
      start: "2026-11-20",
      returnReviewedAt: today,
      baselineReviewedAt: today,
    },
  ])
    assert.equal(
      rides(project({ c: { races: [race], pauses: [p] } }).result).length,
      0,
    );
  assert.equal(
    rides(
      project({ options: { approvedRestDays: ["2026-11-26", "2026-11-28"] } })
        .result,
    ).length,
    0,
  );
  const nearby = {
    ...race,
    id: "next",
    day: "2026-12-01",
    distanceKm: 10,
    terrain: "road" as const,
    elevationGain: 0,
    expectedMinutes: 50,
    priority: "goal" as const,
    recorded: undefined,
  };
  assert.deepEqual(
    rides(project({ c: { races: [race, nearby], pauses: [] } }).result).map(
      (r) => r.day.dayOffset,
    ),
    [3],
  );
  const cal = project().result;
  const unavailable = applyAvailability(cal, [
    {
      day: "2026-11-26",
      slots: ["later"],
      reason: "unavailable",
    },
  ]);
  assert.equal(
    unavailable.days[3].sessions.filter(
      (s) => s.status === "planned" && s.session.sport === "cycling",
    ).length,
    0,
  );
});

test("recorded sessions are preserved, count toward ride limits and leave at most two sessions daily", () => {
  const week: WeekPreferences = {
    hyrox: { monday: "skipping", wednesday: "skipping", friday: "skipping" },
    cyclingDays: [0, 1, 2, 3, 4, 5],
    cycleWhenSkippingHyrox: true,
  };
  const records = [
    { day: "2026-11-25", sport: "cycling", minutes: 90, km: 25 },
  ];
  const { raw, result } = project({
    week,
    records,
    options: { today: "2026-11-26" },
  });
  assert.deepEqual(
    result.days[2].sessions.filter((s) => s.status === "recorded"),
    raw.days[2].sessions.filter((s) => s.status === "recorded"),
  );
  assert.deepEqual(
    rides(result).map((r) => r.day.dayOffset),
    [4],
  );
  const busy = project({
    records: [
      { day: "2026-11-26", sport: "running", minutes: 40, km: 6 },
      { day: "2026-11-26", sport: "other", minutes: 30, km: 0 },
    ],
  }).result;
  assert(!rides(busy).some((r) => r.day.dayOffset === 3));
  assert(
    busy.days[3].recorded.length +
      busy.days[3].sessions.filter((s) => s.status === "planned").length <=
      2,
  );
});

test("fresh sync permits optional cycling without daily reports; stale data and moderate symptoms do not", () => {
  const db = new Database(":memory:");
  migrateDatabase(db);
  const repo = new TrainingRepository(db);
  const sync = (stamp: string) =>
    db
      .prepare(
        "INSERT OR REPLACE INTO sync_state(provider,last_completed_at,updated_at) VALUES('garmin',?,?)",
      )
      .run(stamp, stamp);
  try {
    assert.equal(raceRecoveryEvidence(db, now).cyclingAllowed, false);
    sync(now.toISOString());
    assert.equal(raceRecoveryEvidence(db, now).cyclingAllowed, true);
    for (const stamp of ["2026-11-20T00:00:00Z", "2026-11-24T00:00:00Z"]) {
      sync(stamp);
      assert.equal(raceRecoveryEvidence(db, now).cyclingAllowed, false);
    }
    sync(now.toISOString());
    for (const report of [
      { pain: 1, fatigue: 1, soreness: 1 },
      { pain: 0, fatigue: 3, soreness: 1 },
      { pain: 0, fatigue: 1, soreness: 3 },
    ]) {
      repo.saveCheckIn({ day: today, notes: "", ...report });
      assert.equal(raceRecoveryEvidence(db, now).cyclingAllowed, false);
    }
    repo.saveCheckIn({
      day: today,
      notes: "",
      pain: 0,
      fatigue: 1,
      soreness: 1,
    });
    assert.equal(raceRecoveryEvidence(db, now).cyclingAllowed, true);
    for (const [id, day] of [
      ["a", "2026-11-22"],
      ["b", today],
    ])
      db.prepare(
        "INSERT INTO daily_health(id,day,sleep_seconds,raw_json,imported_at) VALUES(?,?,18000,'{}',?)",
      ).run(id, day, now.toISOString());
    assert.equal(raceRecoveryEvidence(db, now).cyclingAllowed, false);
  } finally {
    db.close();
  }
});
