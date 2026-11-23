import type { RaceEvent } from "./types/commitments";
export function daysBetween(a: string, b: string) {
  return Math.round(
    (Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000,
  );
}
export function raceWindow(r: RaceEvent) {
  const minutes = r.recorded?.minutes ?? r.expectedMinutes;
  const demanding =
    minutes >= 120 || r.distanceKm >= 21.1 || (r.elevationGain ?? 0) >= 500;
  return {
    lead: r.priority === "training" ? 2 : demanding ? 14 : 7,
    recovery: r.distanceKm >= 42 ? 14 : demanding ? 7 : 3,
    fullRest: r.distanceKm >= 42 ? 3 : demanding ? 2 : 1,
  };
}
// Stable across renaming and status updates; training-input edits invalidate reviews.
export function raceRevision(r: RaceEvent) {
  return JSON.stringify([
    r.id,
    r.day,
    r.distanceKm,
    r.terrain,
    r.elevationGain,
    r.expectedMinutes,
    r.priority,
  ]);
}
export function controlledParticipation(r: RaceEvent, previous: RaceEvent) {
  const review = r.participationReview;
  return (
    r.priority === "training" &&
    raceWindow(r).recovery <= 3 &&
    raceWindow(previous).recovery <= 3 &&
    !!review &&
    review.previousId === previous.id &&
    review.previousRevision === raceRevision(previous) &&
    review.revision === raceRevision(r) &&
    daysBetween(r.day, previous.day) > raceWindow(previous).fullRest
  );
}
export function activeRaceSchedule(
  races: RaceEvent[],
  blockedDays: string[] = [],
) {
  const active: RaceEvent[] = [],
    conflicts: { race: RaceEvent; previous: RaceEvent; controlled: boolean }[] =
      [];
  for (const r of [...races]
    .filter((r) => r.status !== "cancelled")
    .sort((a, b) => a.day.localeCompare(b.day))) {
    const recorded = r.status === "completed" || !!r.recorded;
    if (blockedDays.includes(r.day) && !recorded) continue;
    const previous = [...active]
      .reverse()
      .find(
        (p) =>
          p.day < r.day && daysBetween(r.day, p.day) <= raceWindow(p).recovery,
      );
    const controlled = !!previous && controlledParticipation(r, previous);
    if (previous) conflicts.push({ race: r, previous, controlled });
    if (!previous || controlled || recorded) active.push(r);
  }
  return { active, conflicts };
}
export function reviewedBaseReturn(r: RaceEvent, day: string) {
  return (
    !!r.recorded &&
    r.distanceKm < 42 &&
    r.recorded.minutes < 240 &&
    r.recoveryReview?.recordingRevision === JSON.stringify(r.recorded) &&
    r.recoveryReview?.revision === raceRevision(r) &&
    r.recoveryReview.activityId === r.recorded.activityId &&
    day >= r.recoveryReview.from &&
    daysBetween(day, r.day) > raceWindow(r).fullRest
  );
}

// Automatic decisions expire with the local date and are derived afresh. They
// never backdate a change to a completed day or override initial/major-event rest.
export function automaticBaseReturn(r: RaceEvent, day: string, today: string) {
  const assessment = r.automaticRecovery;
  return !!(
    r.recorded &&
    r.status !== "cancelled" &&
    r.distanceKm < 42 &&
    r.recorded.minutes < 240 &&
    assessment?.status === "base" &&
    assessment.checkedOn === today &&
    assessment.from >= today &&
    day >= assessment.from &&
    assessment.revision === raceRevision(r) &&
    assessment.recordingRevision === JSON.stringify(r.recorded) &&
    daysBetween(day, r.day) > raceWindow(r).fullRest &&
    daysBetween(day, r.day) <= raceWindow(r).recovery
  );
}
