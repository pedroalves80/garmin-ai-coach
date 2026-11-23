import { AutomaticRecoveryNotice } from "./AutomaticRecoveryNotice";
import Link from "next/link";
import { activeRaceSchedule, raceWindow } from "@/shared/race-policy";
import { dayOffsetDate } from "@/shared/weekly-schedule";
import { weeklyMileageExplanation } from "@/shared/weekly-mileage-explanation";
import type { RaceEvent } from "@/shared/types/commitments";
import type { TrainingPlan } from "@/shared/types/metrics";
import type { WeekSchedule } from "@/shared/types/schedule";
export function RaceWeekNotice({
  races,
  plan,
  calendar,
}: {
  races: RaceEvent[];
  plan: TrainingPlan;
  calendar: WeekSchedule;
}) {
  const summary = weeklyMileageExplanation(plan, calendar);
  const schedule = activeRaceSchedule(races);
  const affected = races.filter(
    (r) =>
      r.status !== "cancelled" &&
      plan.start <= dayOffsetDate(r.day, raceWindow(r).recovery) &&
      dayOffsetDate(plan.start, 6) >=
        dayOffsetDate(r.day, -Math.max(6, raceWindow(r).lead)),
  );
  if (
    !affected.length &&
    summary.shortfallKm < 0.05 &&
    !summary.unresolved.length
  )
    return null;
  return (
    <aside
      className="surface race-week-notice"
      aria-label="Weekly mileage and event adjustments"
    >
      <strong>
        {summary.milestoneKm.toFixed(1)} km milestone →{" "}
        {summary.scheduledKm.toFixed(1)} km scheduled
      </strong>
      {Math.abs(summary.baselineKm - summary.milestoneKm) > 0.05 && (
        <p className="small-text">
          Reviewed baseline: {summary.baselineKm.toFixed(1)} km before calendar
          adjustments.
        </p>
      )}
      {summary.shortfallKm > 0.05 && (
        <p className="small-text">
          {summary.shortfallKm.toFixed(1)} km below the reviewed baseline. The
          changes below explain the calendar difference; this does not establish
          a lower fitness baseline.
        </p>
      )}
      {!!summary.unresolved.length && (
        <p className="small-text">
          <strong>Participation unresolved.</strong>{" "}
          {summary.unresolved.map((d) => d.day).join(", ")}: registered event
          withheld. Its course is excluded and it adds no recovery days unless a
          matching recording later confirms it happened. Resolve participation
          in Events before accepting this week.
        </p>
      )}
      {summary.provisionalRecovery && (
        <p className="small-text">
          <strong>Provisional recovery forecast.</strong> The app reassesses
          after a matching Garmin recording, using recorded duration/distance,
          entered terrain/ascent and available recovery signals. Missing daily
          check-ins do not lock the forecast. Completed recovery runs and fresh
          Garmin overnight data can automatically restore your existing base
          range; future days remain provisional.
        </p>
      )}
      {affected
        .filter((r) => r.automaticRecovery)
        .map((r) => (
          <AutomaticRecoveryNotice key={r.id} race={r} />
        ))}
      <details>
        <summary>Why these kilometres and targets?</summary>
        {affected.map((r) => (
          <p className="small-text" key={r.id}>
            <strong>{r.name}</strong> · {r.day} · {r.distanceKm} km {r.terrain}
            {r.elevationGain !== null ? ` · +${r.elevationGain} m` : ""}.{" "}
            {schedule.active.some((a) => a.id === r.id)
              ? `${r.recorded ? "Matched recording informs" : "Entered details forecast"} ${raceWindow(r).fullRest} initial rest day(s), then reduced intensity through ${dayOffsetDate(r.day, raceWindow(r).recovery)}. ${r.recoveryReview ? "A saved return review may restore base effort; quality stays reduced." : "Recovery targets are the athlete’s configured range, not a measured threshold."}`
              : "Withheld: no additional recovery window is applied."}
          </p>
        ))}
        {summary.changes.map((c) => (
          <p className="small-text" key={c.day}>
            <strong>
              {c.day}: {c.beforeKm.toFixed(2)} → {c.afterKm.toFixed(2)} km.
            </strong>{" "}
            {c.reason}
          </p>
        ))}
        <p className="muted small-text">
          Calendar changes include moved or resized runs and race replacements;
          the net difference determines the weekly total. Hyrox and race
          warm-up/cool-down are excluded from milestone mileage. Running takes
          priority over supporting sessions; initial rest, availability,
          distance limits and explicit goal tapers still apply. Missed
          kilometres are never packed into a partial week.
        </p>
      </details>
      <Link href="/events" className="text-link">
        Review races & recovery →
      </Link>
    </aside>
  );
}
