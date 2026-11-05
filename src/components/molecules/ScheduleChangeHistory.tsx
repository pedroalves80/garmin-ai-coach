"use client";

import type { ScheduleEditHistory } from "@/shared/types/rescheduling";
import { Button } from "../atoms/Button";
import { dateLabel, reasons } from "./schedule-change-labels";

export function ScheduleChangeHistory({
  history,
  pending,
  onUndo,
}: {
  history: ScheduleEditHistory[];
  pending: boolean;
  onUndo: (id: string) => void;
}) {
  return (
    <div className="adjustment-history">
      <h4>Recent change history</h4>
      {!history.length && (
        <p className="muted small-text">No schedule changes yet.</p>
      )}
      <ol>
        {history.slice(0, 10).map((entry) => (
          <li className="adjustment-history-item" key={entry.id}>
            <strong>{entry.summary}</strong>
            <p className="muted small-text">
              <time dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
              {entry.reason ? ` · ${reasons[entry.reason]}` : ""}
            </p>
            <p className="muted small-text">
              {entry.days.map(dateLabel).join(" · ")}
            </p>
            {entry.undoneAt ? (
              <p className="muted small-text">Undone</p>
            ) : entry.canUndo ? (
              <Button
                type="button"
                className="button-secondary"
                disabled={pending}
                onClick={() => onUndo(entry.id)}
              >
                Preview undo
              </Button>
            ) : (
              <p className="muted small-text">
                {entry.undoReason ?? "Undo unavailable for this change."}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
