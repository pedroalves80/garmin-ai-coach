import type { ChangeReason } from "@/shared/types/rescheduling";
import type { SessionState } from "@/shared/types/schedule";

export const slotLabels = {
  morning: "Morning",
  lunch: "Lunch",
  later: "Later",
  event: "Race",
};
export const reasons: Record<ChangeReason, string> = {
  unavailable: "Unavailable",
  tired: "Feeling tired",
  other: "Other",
};

export function dateLabel(day: string) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function sessionLabel({ session }: SessionState) {
  return `${slotLabels[session.slot]} · ${session.sport === "hyrox" ? "Hyrox class" : session.workout.title}`;
}
