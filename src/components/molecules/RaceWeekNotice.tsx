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
      {affected.map((r) => {
        const window = raceWindow(r);
        const prep = dayOffsetDate(r.day, -window.lead);
        return (
          <p key={r.id} className="small-text">
            <strong>{r.name}</strong> · {r.day} · {r.distanceKm} km {r.terrain}
            {r.elevationGain !== null ? ` · +${r.elevationGain} m` : ""}.{" "}
            {r.priority === "goal" ? "Goal" : "Training"} race: {window.lead}
            -day preparation window starts {prep}; recovery window ends{" "}
            {dayOffsetDate(r.day, window.recovery)}.{" "}
            {daysBetween(r.day, start) > 6
              ? "Preparation can affect this week even though the race is later."
              : "The event replaces ordinary training around race day."}
          </p>
        );
      })}
      <p className="muted small-text">
        The baseline plan and recorded activities are retained. The calendar
        shows the race preparation/recovery overlay; removed distance is not
        moved elsewhere. Review the dates and race priority in Races & training
        breaks.
      </p>
    </aside>
  );
}
