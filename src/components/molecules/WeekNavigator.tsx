"use client";
import { dayOffsetDate } from "@/shared/weekly-schedule";
import { weekMonday } from "@/shared/week-view";
import { Button } from "../atoms/Button";
export function WeekNavigator({
  start,
  current,
  min,
  max,
  onChange,
}: {
  start: string;
  current: string;
  min: string;
  max: string;
  onChange: (start: string) => void;
}) {
  return (
    <nav className="surface week-navigator" aria-label="Browse training weeks">
      <div className="week-navigation-buttons">
        <Button
          type="button"
          className="button-secondary"
          aria-label="Previous week"
          disabled={dayOffsetDate(start, -7) < min}
          onClick={() => onChange(dayOffsetDate(start, -7))}
        >
          ← Previous
        </Button>
        <Button
          type="button"
          className="button-secondary"
          disabled={start === current}
          onClick={() => onChange(current)}
        >
          This week
        </Button>
        <Button
          type="button"
          className="button-secondary"
          aria-label="Next week"
          disabled={dayOffsetDate(start, 7) > max}
          onClick={() => onChange(dayOffsetDate(start, 7))}
        >
          Next →
        </Button>
      </div>
      <label htmlFor="browse-week">
        Jump to week
        <input
          id="browse-week"
          type="date"
          min={min}
          max={dayOffsetDate(max, 6)}
          value={start}
          onChange={(e) => {
            if (e.target.value) {
              const monday = weekMonday(e.target.value);
              if (monday >= min && monday <= max) onChange(monday);
            }
          }}
        />
      </label>
    </nav>
  );
}
