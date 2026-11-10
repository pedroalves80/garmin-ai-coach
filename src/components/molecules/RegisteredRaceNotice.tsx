import Link from "next/link";
import type { ScheduledDay } from "@/shared/types/schedule";
export function RegisteredRaceNotice({ day }: { day: ScheduledDay }) {
  if (
    !day.race ||
    day.sessions.some(
      (s) => s.session.sport === "running" && s.session.workout.race,
    )
  )
    return null;
  return (
    <aside
      className="inline-notice registered-race-notice"
      aria-label="Registered race needs review"
    >
      <strong>
        {day.race.name} · {day.race.distanceKm} km {day.race.terrain}
      </strong>
      <p className="small-text">
        Registered for {day.race.day}
        {day.race.startTime ? ` at ${day.race.startTime}` : ""} ·{" "}
        <strong>Not prescribed · needs review</strong>. The event has not
        disappeared or been cancelled. Recovery, a training break or an approved
        rest decision currently prevents prescribing it.
      </p>
      <Link href="/events" className="text-link">
        Review event priorities and conflicts →
      </Link>
    </aside>
  );
}
