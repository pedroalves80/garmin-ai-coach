"use client";
import { AutomaticRecoveryNotice } from "./AutomaticRecoveryNotice";
import { useState } from "react";
import {
  activeRaceSchedule,
  daysBetween,
  raceRevision,
  raceWindow,
  reviewedBaseReturn,
  automaticBaseReturn,
} from "@/shared/race-policy";
import type { RaceEvent } from "@/shared/types/commitments";
import { Button } from "../atoms/Button";
export function RaceReviewControls({
  race,
  races,
  today,
  pending,
  onSave,
}: {
  race: RaceEvent;
  races: RaceEvent[];
  today: string;
  pending: boolean;
  onSave: (body: object) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const overlap = activeRaceSchedule(races).conflicts.find(
    (c) => c.race.id === race.id,
  );
  const window = raceWindow(race),
    elapsed = daysBetween(today, race.day);
  const participation =
    !!overlap &&
    !overlap.controlled &&
    race.status === "planned" &&
    race.day >= today;
  const canControl =
    participation &&
    race.priority === "training" &&
    raceWindow(overlap.previous).recovery <= 3 &&
    window.recovery <= 3 &&
    daysBetween(race.day, overlap.previous.day) >
      raceWindow(overlap.previous).fullRest;
  const returnReview =
    !!race.recorded &&
    elapsed > window.fullRest &&
    elapsed <= window.recovery &&
    race.distanceKm < 42 &&
    race.recorded.minutes < 240 &&
    !reviewedBaseReturn(race, today) &&
    !automaticBaseReturn(race, today, today);
  const waitingForRecording =
    elapsed > 0 && elapsed <= window.recovery && !race.recorded;
  if (
    !race.automaticRecovery &&
    !waitingForRecording &&
    !participation &&
    !returnReview &&
    !overlap?.controlled &&
    !reviewedBaseReturn(race, today)
  )
    return null;
  return (
    <aside
      className="inline-notice small-text"
      aria-label={`Review ${race.name}`}
    >
      <AutomaticRecoveryNotice race={race} />
      {waitingForRecording && (
        <p>
          <strong>Provisional recovery forecast.</strong> Sync a matching Garmin
          recording to reassess duration. After initial rest, completed recovery
          runs and fresh overnight data can support an automatic return to base.
          Daily check-ins are optional.
        </p>
      )}
      {participation && (
        <>
          <strong>Participation needs a decision</strong>
          <p>
            This event is {daysBetween(race.day, overlap.previous.day)} days
            after {overlap.previous.day}. It stays registered but is withheld.
            Withheld events do not add recovery days or count as scheduled
            kilometres.
          </p>
          <p>
            Use Edit race to change its date or priority, or Cancel race if you
            will skip it.{" "}
            {canControl
              ? "You can instead explicitly keep this training event at the workout’s recovery HR target. This is a participation choice, not an all-out race recommendation."
              : "Initial rest and demanding-event restrictions remain protected."}
          </p>
        </>
      )}
      {overlap?.controlled && (
        <p>
          <strong>Controlled participation reviewed.</strong> Follow the course
          step’s recovery HR target. Changing either event’s training details
          requires a new review.
        </p>
      )}
      {returnReview && (
        <>
          <strong>Optional manual return-to-base review</strong>
          <p>
            Matched Garmin recording: {race.recorded!.km.toFixed(1)} km ·{" "}
            {race.recorded!.minutes.toFixed(0)} min. Entered terrain/ascent and
            current recovery signals also inform the forecast. A one-time review
            can restore base effort from today if the automatic assessment still
            lacks evidence. Tempo, strides and Hyrox stay withheld; optional
            cycling retains its recovery limits. Daily check-ins are optional.
          </p>
        </>
      )}
      {reviewedBaseReturn(race, today) && (
        <p>
          <strong>Return to base reviewed.</strong> Base effort resumes from{" "}
          {race.recoveryReview!.from}; the remaining recovery window still
          excludes added quality.
        </p>
      )}
      {(canControl || returnReview) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!confirm) return;
            onSave(
              canControl
                ? {
                    action: "review_race_participation",
                    id: race.id,
                    previousId: overlap!.previous.id,
                    revision: raceRevision(race),
                    previousRevision: raceRevision(overlap!.previous),
                    confirmed: true,
                  }
                : {
                    action: "review_race_recovery",
                    id: race.id,
                    revision: raceRevision(race),
                    activityId: race.recorded!.activityId,
                    confirmed: true,
                  },
            );
            setConfirm(false);
          }}
        >
          <label className="race-review-confirmation">
            <input
              type="checkbox"
              required
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            {canControl
              ? "I choose controlled participation at recovery effort and will reassess if my recovery changes."
              : "I am comfortable returning to base running, with no current pain or unusual fatigue/soreness."}
          </label>
          <Button disabled={pending || !confirm} className="button-secondary">
            {canControl
              ? "Save controlled participation"
              : "Save return to base"}
          </Button>
        </form>
      )}
    </aside>
  );
}
