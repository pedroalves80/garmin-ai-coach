import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { prepare } from "../db/statements";
import type { WeekSchedule } from "../../shared/types/schedule";
import type { PrescriptionSnapshot } from "../../shared/types/workout-review";
export function snapshotSignature(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function prescriptionSnapshots(
  db: Database.Database,
): PrescriptionSnapshot[] {
  return (
    prepare(
      db,
      "SELECT rowid AS sequence,* FROM workout_prescriptions ORDER BY captured_at,rowid",
    ).all() as {
      id: string;
      sequence: number;
      session_key: string;
      planned_day: string;
      captured_at: string;
      workout_json: string | null;
      easy_pace: number;
      plan_start: string;
      source: PrescriptionSnapshot["source"];
      signature: string;
    }[]
  ).map((r) => ({
    id: r.id,
    sequence: r.sequence,
    sessionKey: r.session_key,
    day: r.planned_day,
    capturedAt: r.captured_at,
    workout: r.workout_json ? JSON.parse(r.workout_json) : null,
    easyPace: r.easy_pace,
    planStart: r.plan_start,
    source: r.source,
    signature: r.signature,
  }));
}
export function recordPrescriptionCalendar(
  db: Database.Database,
  calendar: WeekSchedule,
  easyPace: number,
  now: Date,
  source: PrescriptionSnapshot["source"] = "change",
  planStart = calendar.start,
) {
  const stamp = now.toISOString(),
    desired = calendar.days.flatMap((d) =>
      d.sessions.flatMap((s) =>
        s.session.sport === "running" && s.status === "planned"
          ? [
              {
                sessionKey: s.session.id ?? `${d.day}:running`,
                day: d.day,
                workout: s.session.workout,
              },
            ]
          : [],
      ),
    );
  const preserved = new Set(
    calendar.days.flatMap((d) =>
      d.sessions
        .filter((s) => s.session.sport === "running" && s.status !== "planned")
        .map((s) => s.session.id ?? `${d.day}:running`),
    ),
  );
  const days = new Set(calendar.days.map((d) => d.day));
  let current: {
    session_key: string;
    planned_day: string;
    workout_json: string | null;
    easy_pace: number;
    plan_start: string;
    signature: string;
    captured_at: string;
  }[] = [];
  const readCurrent = () =>
    prepare(
      db,
      "SELECT p.* FROM prescription_current c JOIN workout_prescriptions p ON p.id=c.snapshot_id",
    ).all() as {
      session_key: string;
      planned_day: string;
      workout_json: string | null;
      easy_pace: number;
      plan_start: string;
      signature: string;
      captured_at: string;
    }[];
  const append = (
    key: string,
    day: string,
    workout: unknown | null,
    pace: number,
    start: string,
  ) => {
    const signature = snapshotSignature({ day, workout, easyPace: pace });
    const prior = current.find((r) => r.session_key === key);
    if (prior?.signature === signature) return;
    const id = randomUUID();
    prepare(
      db,
      "INSERT INTO workout_prescriptions(id,session_key,planned_day,captured_at,workout_json,easy_pace,plan_start,source,signature) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      key,
      day,
      stamp,
      workout ? JSON.stringify(workout) : null,
      pace,
      start,
      source,
      signature,
    );
    prepare(
      db,
      "INSERT INTO prescription_current(session_key,snapshot_id) VALUES(?,?) ON CONFLICT(session_key) DO UPDATE SET snapshot_id=excluded.snapshot_id",
    ).run(key, id);
  };
  db.transaction(() => {
    current = readCurrent();
    for (const r of current)
      if (
        r.workout_json &&
        days.has(r.planned_day) &&
        !desired.some((d) => d.sessionKey === r.session_key) &&
        !preserved.has(r.session_key)
      )
        append(r.session_key, r.planned_day, null, r.easy_pace, r.plan_start);
    for (const r of desired)
      append(r.sessionKey, r.day, r.workout, easyPace, planStart);
  }).immediate();
}
