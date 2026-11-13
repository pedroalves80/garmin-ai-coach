import type { ScheduledDay, SessionState } from "./schedule";

export type TrainingSlot = "morning" | "lunch" | "later";
export type ChangeReason = "unavailable" | "tired" | "other";
export type AvailabilityBlock = {
  day: string;
  slots: TrainingSlot[];
  reason: ChangeReason;
};
export type ScheduleEdit =
  | {
      action: "move";
      day: string;
      sessionId: string;
      toDay: string;
      toSlot: TrainingSlot;
      reason: ChangeReason;
    }
  | {
      action: "swap";
      day: string;
      sessionId: string;
      withDay: string;
      withSessionId: string;
      reason: ChangeReason;
    }
  | {
      action: "terrain";
      day: string;
      sessionId: string;
      terrain: "road" | "trail";
      expectedMinutes?: number;
      ascentM?: number;
      reason: ChangeReason;
    }
  | { action: "skip"; day: string; sessionId: string; reason: ChangeReason }
  | {
      action: "availability";
      day: string;
      slots: TrainingSlot[];
      reason: ChangeReason;
    }
  | { action: "undo"; id: string };
export type ScheduleEditPreview = {
  revision: string;
  request: ScheduleEdit;
  summary: string;
  days: {
    day: string;
    before: SessionState[];
    after: SessionState[];
    beforeUnavailable: TrainingSlot[];
    afterUnavailable: TrainingSlot[];
  }[];
  weeks: { start: string; beforeKm: number; afterKm: number }[];
  warnings: string[];
};
export type ScheduleEditHistory = {
  id: string;
  createdAt: string;
  summary: string;
  reason: ChangeReason | null;
  days: string[];
  undoneAt: string | null;
  canUndo: boolean;
  undoReason: string | null;
};
export type ScheduleEditCatalog = {
  today: string;
  days: ScheduledDay[];
  easyPaces: Record<string, number>;
  availability: AvailabilityBlock[];
  history: ScheduleEditHistory[];
};
