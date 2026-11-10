import type { RaceEvent } from "./types/commitments";
import type { RacePaceEvidence, RacePaceAdvice } from "./types/race-pacing";
import { daysBetween, raceWindow } from "./commitment-calendar";
export function racePacing(
  race: RaceEvent,
  evidence: RacePaceEvidence[],
  today: string,
  races: RaceEvent[],
  context: { longestKm: number; runningKm: number; matchedPairs: number },
): RacePaceAdvice {
  const advice: RacePaceAdvice = {
    raceId: race.id,
    day: race.day,
    terrain: race.terrain,
    confidence: "none",
    status: "insufficient",
    reference: null,
    predictedSeconds: null,
    predictedPace: null,
    range: null,
    notes: [],
  };
  const conflict = races.find(
    (r) =>
      r.status !== "cancelled" &&
      r.day < race.day &&
      daysBetween(race.day, r.day) <= raceWindow(r).recovery,
  );
  if (race.terrain === "trail")
    return {
      ...advice,
      status: "trail",
      notes: [
        "Use effort and terrain rather than a road pace. Elevation, descents and technical footing are not modelled by a flat-road prediction.",
      ],
    };
  const eligible = evidence
    .filter(
      (e) =>
        e.day <= today &&
        daysBetween(today, e.day) <=
          (e.source === "garmin_prediction" ? 30 : 90) &&
        race.distanceKm >= 3 &&
        race.distanceKm <= 21.1 &&
        (e.source === "garmin_prediction"
          ? Math.abs(e.distanceKm - race.distanceKm) < 0.05
          : race.distanceKm / e.distanceKm >= 0.5 &&
            race.distanceKm / e.distanceKm <= 2),
    )
    .sort(
      (a, b) =>
        b.day.localeCompare(a.day) ||
        (a.source === "garmin_prediction" ? 1 : 0) -
          (b.source === "garmin_prediction" ? 1 : 0),
    );
  const ref = eligible[0];
  if (!ref)
    advice.notes.push(
      "Add a recent road race/time-trial result or a current Garmin prediction for this distance. Ordinary training averages and an entered event goal are not race-performance evidence.",
    );
  else {
    const seconds =
        ref.seconds * Math.pow(race.distanceKm / ref.distanceKm, 1.07),
      pace = seconds / race.distanceKm,
      garmin = ref.source === "garmin_prediction";
    advice.reference = ref;
    advice.predictedSeconds = Math.round(seconds);
    advice.predictedPace = pace;
    advice.confidence = garmin ? "low" : "moderate";
    advice.notes.push(
      garmin
        ? "User-reported Garmin prediction, not a completed performance or confirmation of readiness."
        : "Based on a user-confirmed road performance; cross-distance estimates use Riegel exponent 1.07 and are limited to half-marathon distance and a 2× distance ratio.",
    );
    advice.notes.push(
      `Training context: ${context.runningKm.toFixed(1)} km in the last completed week; longest recorded run in 30 days ${context.longestKm.toFixed(1)} km. ${context.matchedPairs < 3 ? "Too few matched pace/HR pairs to claim a fitness improvement." : "Matched pace/HR observations remain context; they do not automatically make race targets faster."}`,
    );
    advice.notes.push(
      "This reflects current evidence, not promised race-day fitness. Course elevation, weather, interruptions and race-day recovery are not validated. Recheck closer to the event.",
    );
    advice.range = {
      min: Math.ceil((pace * (garmin ? 1.05 : 1)) / 5) * 5,
      max: Math.ceil((pace * (garmin ? 1.1 : 1.05)) / 5) * 5,
    };
    advice.status = "provisional";
    advice.notes.push(
      garmin
        ? "The provisional range is 5–10% slower than the Garmin estimate, rounded conservatively. This is an app planning heuristic, not a validated confidence interval or a guarantee that the pace is sustainable."
        : "The provisional range runs from the estimated pace to 5% slower, rounded conservatively. It is a planning heuristic, not a validated confidence interval.",
    );
  }
  if (race.priority === "training") {
    advice.status = "training";
    advice.range = null;
    advice.notes.unshift(
      "Training race: keep the prescribed controlled effort (RPE 6–7); the performance estimate is not an instruction to race all-out.",
    );
  }
  if (conflict) {
    advice.status = "conflict";
    advice.range = null;
    advice.notes.unshift(
      `Recovery conflict: this event is ${daysBetween(race.day, conflict.day)} days after ${conflict.day}, within its ${raceWindow(conflict).recovery}-day recovery window. It stays registered but is not prescribed; no execution pace is recommended.`,
    );
  }
  return advice;
}
export function racePacingContext(advice: RacePaceAdvice[]) {
  return advice
    .slice(0, 6)
    .map(
      ({
        day,
        terrain,
        status,
        confidence,
        predictedPace,
        range,
        reference,
        notes,
      }) => ({
        day,
        terrain,
        status,
        confidence,
        predictedPace,
        range,
        reference: reference
          ? {
              day: reference.day,
              source: reference.source,
              distanceKm: reference.distanceKm,
              seconds: reference.seconds,
            }
          : null,
        notes: notes.slice(0, 2).map((n) => n.slice(0, 220)),
      }),
    );
}
export function finishTime(seconds: number) {
  const n = Math.round(seconds);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
