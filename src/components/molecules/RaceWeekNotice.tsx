import Link from "next/link";
import { raceWindow, daysBetween } from "@/shared/commitment-calendar";
import { dayOffsetDate } from "@/shared/weekly-schedule";
import { weekMonday } from "@/shared/week-view";
import type { RaceEvent } from "@/shared/types/commitments";
export function RaceWeekNotice({
  start,
  races,
  baseKm,
  effectiveKm,
}: {
  start: string;
  races: RaceEvent[];
  baseKm: number;
  effectiveKm: number;
}) {
  const affected = races.filter(
    (r) =>
      r.status !== "cancelled" &&
      start <= dayOffsetDate(r.day, raceWindow(r).recovery) &&
      dayOffsetDate(start, 6) >=
        (weekMonday(r.day) < dayOffsetDate(r.day, -raceWindow(r).lead)
          ? weekMonday(r.day)
          : dayOffsetDate(r.day, -raceWindow(r).lead)),
  );
  if (!affected.length) return null;
  return (
    <aside
      className="surface race-week-notice"
      aria-label="Race adjustments for this week"
    >
      <strong>
        Race-adjusted calendar · {effectiveKm.toFixed(1)} km shown /{" "}
        {baseKm.toFixed(1)} km baseline
      </strong>
      {baseKm > 0 && effectiveKm < baseKm - 0.05 && (
        <p className="small-text">
          {((1 - effectiveKm / baseKm) * 100).toFixed(0)}% below the{" "}
          {baseKm.toFixed(1)} km baseline. This is a calendar adjustment, not a
          new fitness baseline. Initial rest, goal-race tapering, recovery
          concerns or fitting a fixed course alongside the 5 km training-run
          minimum can reduce the total.
        </p>
      )}
      {affected.map((r) => {
        const window = raceWindow(r);
        const prep = dayOffsetDate(r.day, -window.lead);
        return (
          <p key={r.id} className="small-text">
            <strong>{r.name}</strong> · {r.day} · {r.distanceKm} km {r.terrain}
            {r.elevationGain !== null ? ` · +${r.elevationGain} m` : ""}.{" "}
            {r.priority === "goal" ? "Goal" : "Training"} race: {window.lead}
            -day preparation window starts {prep}; recovery-effort window ends{" "}
            {dayOffsetDate(r.day, window.recovery)}. Initial rest:{" "}
            {window.fullRest} day(s).{" "}
            {daysBetween(r.day, start) > 6
              ? "Preparation can affect this week even though the race is later."
              : "The event replaces ordinary training around race day."}
          </p>
        );
      })}
      <p className="muted small-text">
        Race-course kilometres count towards the mileage target; race
        warm-up/cool-down stay in total running and physical load. Hyrox never
        contributes running mileage. The baseline plan and recorded activities
        are retained. The calendar reduces intensity and nearby supporting
        sessions first. Recovery runs retain their distances after initial rest
        unless recovery evidence calls for less; there is no blanket 5 km
        post-race cap. Removed distance is not automatically made up. Review the
        dates and race priority in Races & training breaks.
      </p>
      <Link href="/events" className="text-link">
        Manage races & training breaks →
      </Link>
    </aside>
  );
}
