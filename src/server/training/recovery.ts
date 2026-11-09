import type { RecoveryEvidence } from "../../shared/types/weekly-planning";
import { shiftDay } from "./dates";
export type HealthEvidenceRow = {
  day: string;
  restingHeartRate: number | null;
  sleepSeconds: number | null;
};
function median(values: number[]) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y),
    i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}
export function garminRecovery(
  rows: HealthEvidenceRow[],
  today: string,
): RecoveryEvidence {
  const valid = rows.filter(
    (r) => r.day <= today && r.day >= shiftDay(today, -28),
  );
  const recent = valid.filter((r) => r.day >= shiftDay(today, -3));
  const baseline = valid.filter((r) => r.day < shiftDay(today, -3));
  const hr = recent.flatMap((r) =>
    r.restingHeartRate !== null &&
    r.restingHeartRate >= 30 &&
    r.restingHeartRate <= 150
      ? [r.restingHeartRate]
      : [],
  );
  const prior = baseline.flatMap((r) =>
    r.restingHeartRate !== null &&
    r.restingHeartRate >= 30 &&
    r.restingHeartRate <= 150
      ? [r.restingHeartRate]
      : [],
  );
  const sleep = recent.flatMap((r) =>
    r.sleepSeconds !== null && r.sleepSeconds > 0 && r.sleepSeconds <= 86400
      ? [r.sleepSeconds / 3600]
      : [],
  );
  const recentRestingHr = median(hr),
    baselineRestingHr = median(prior),
    recentSleepHours = median(sleep);
  const latestDay =
    recent
      .map((r) => r.day)
      .sort()
      .at(-1) ?? null;
  const elevated =
    hr.length >= 2 &&
    prior.length >= 5 &&
    recentRestingHr !== null &&
    baselineRestingHr !== null &&
    recentRestingHr >= baselineRestingHr + 7;
  const shortSleep = sleep.filter((h) => h < 6).length >= 2;
  const covered =
    latestDay !== null &&
    latestDay >= shiftDay(today, -1) &&
    hr.length >= 2 &&
    prior.length >= 5 &&
    sleep.length >= 2;
  const status =
    elevated || shortSleep ? "caution" : covered ? "supportive" : "unknown";
  return {
    status,
    latestDay,
    recentRestingHr,
    baselineRestingHr,
    recentSleepHours,
    recentDays: recent.length,
    notes:
      status === "caution"
        ? [
            elevated
              ? "Recent resting HR is elevated relative to your recorded baseline."
              : "Several recent nights have short recorded sleep.",
            "These are planning flags, not a diagnosis; use a lighter week and report symptoms when needed.",
          ]
        : status === "supportive"
          ? [
              "Recent sleep and resting HR are available without the configured recovery flags. This does not confirm absence of pain or illness.",
            ]
          : [
              "Recent sleep/resting-HR coverage is incomplete. Keep an established week available; missing recovery data is not a failed check-in.",
            ],
  };
}
