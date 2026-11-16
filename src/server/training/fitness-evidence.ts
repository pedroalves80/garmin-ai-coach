import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prepare } from "../db/statements";
import { calendarDate } from "./dates";
import type { FitnessEvidence } from "../../shared/types/workout-review";
export class FitnessEvidenceError extends Error {}
const common = {
  observedOn: z.iso.date().nullable(),
  heartRate: z.number().int().min(60).max(230),
  device: z.string().trim().max(80).default(""),
  sensor: z.string().trim().max(80).default(""),
};
const fields = z.discriminatedUnion("kind", [
  z
    .object({
      ...common,
      kind: z.literal("threshold"),
      source: z.enum(["garmin_estimate", "field_test", "lab_test"]),
      paceSeconds: z.number().int().min(150).max(600),
      powerWatts: z.number().positive().max(1500).nullable(),
      wattsPerKg: z.number().positive().max(20).nullable(),
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("base_observation"),
      source: z.literal("self_report"),
      comfortableTalk: z.boolean(),
      controlledBreathing: z.boolean(),
    })
    .strict(),
]);
export const fitnessEvidenceInput = z.union([
  z
    .object({
      action: z.literal("save"),
      id: z.uuid().optional(),
      evidence: fields,
    })
    .strict(),
  z.object({ action: z.enum(["archive", "restore"]), id: z.uuid() }).strict(),
]);
export function fitnessEvidence(db: Database.Database): FitnessEvidence[] {
  return (
    prepare(
      db,
      "SELECT * FROM fitness_evidence ORDER BY reported_at DESC,id DESC LIMIT 200",
    ).all() as {
      id: string;
      kind: FitnessEvidence["kind"];
      observed_on: string | null;
      data_json: string;
      reported_at: string;
      archived_at: string | null;
    }[]
  ).map((r) => ({
    paceSeconds: null,
    powerWatts: null,
    wattsPerKg: null,
    comfortableTalk: null,
    controlledBreathing: null,
    ...JSON.parse(r.data_json),
    id: r.id,
    kind: r.kind,
    observedOn: r.observed_on,
    reportedAt: r.reported_at,
    archivedAt: r.archived_at,
  }));
}
export function saveFitnessEvidence(
  db: Database.Database,
  input: unknown,
  now = new Date(),
) {
  const v = fitnessEvidenceInput.parse(input),
    stamp = now.toISOString();
  return db
    .transaction(() => {
      if (v.action !== "save") {
        const old = fitnessEvidence(db).find((e) => e.id === v.id);
        if (!old) throw new FitnessEvidenceError("Evidence not found.");
        prepare(db, "UPDATE fitness_evidence SET archived_at=? WHERE id=?").run(
          v.action === "archive" ? stamp : null,
          v.id,
        );
        return;
      }
      if (v.evidence.observedOn && v.evidence.observedOn > calendarDate(now))
        throw new FitnessEvidenceError(
          "The measurement date cannot be in the future. Leave it unknown if you do not know it.",
        );
      const old = v.id
        ? fitnessEvidence(db).find((e) => e.id === v.id && !e.archivedAt)
        : undefined;
      if (v.id && !old)
        throw new FitnessEvidenceError(
          "This evidence changed. Refresh before editing.",
        );
      if (old && old.kind !== v.evidence.kind)
        throw new FitnessEvidenceError("Keep the evidence type when editing.");
      const same = fitnessEvidence(db).find(
        (e) =>
          !e.archivedAt &&
          e.observedOn === v.evidence.observedOn &&
          e.kind === v.evidence.kind &&
          e.heartRate === v.evidence.heartRate &&
          e.source === v.evidence.source &&
          e.paceSeconds ===
            ("paceSeconds" in v.evidence ? v.evidence.paceSeconds : null) &&
          e.powerWatts ===
            ("powerWatts" in v.evidence ? v.evidence.powerWatts : null) &&
          e.wattsPerKg ===
            ("wattsPerKg" in v.evidence ? v.evidence.wattsPerKg : null) &&
          e.comfortableTalk ===
            ("comfortableTalk" in v.evidence
              ? v.evidence.comfortableTalk
              : null) &&
          e.controlledBreathing ===
            ("controlledBreathing" in v.evidence
              ? v.evidence.controlledBreathing
              : null) &&
          e.device === v.evidence.device &&
          e.sensor === v.evidence.sensor,
      );
      if (same && (!old || same.id === old.id)) return same.id;
      if (old)
        prepare(db, "UPDATE fitness_evidence SET archived_at=? WHERE id=?").run(
          stamp,
          old.id,
        );
      const id = randomUUID();
      prepare(
        db,
        "INSERT INTO fitness_evidence(id,kind,observed_on,data_json,reported_at,archived_at) VALUES(?,?,?,?,?,NULL)",
      ).run(
        id,
        v.evidence.kind,
        v.evidence.observedOn,
        JSON.stringify(v.evidence),
        stamp,
      );
      return id;
    })
    .immediate();
}
export function fitnessEvidenceSummary(db: Database.Database) {
  const all = fitnessEvidence(db).filter((e) => !e.archivedAt);
  const latest = (kind: FitnessEvidence["kind"]) =>
    all
      .filter((e) => e.kind === kind)
      .sort(
        (a, b) =>
          (b.observedOn ?? "").localeCompare(a.observedOn ?? "") ||
          b.reportedAt.localeCompare(a.reportedAt),
      )[0];
  const threshold = latest("threshold"),
    base = latest("base_observation");
  return {
    threshold: threshold
      ? {
          source: threshold.source,
          observedOn: threshold.observedOn,
          reportedOn: threshold.reportedAt.slice(0, 10),
          hr: threshold.heartRate,
          pace: threshold.paceSeconds,
          runningPower: threshold.powerWatts,
        }
      : null,
    base: base
      ? {
          source: base.source,
          observedOn: base.observedOn,
          reportedOn: base.reportedAt.slice(0, 10),
          hr: base.heartRate,
          comfortableTalk: base.comfortableTalk,
          controlledBreathing: base.controlledBreathing,
        }
      : null,
  };
}
