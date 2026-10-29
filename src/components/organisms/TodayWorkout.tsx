import { StatusBadge } from "@/components/atoms/StatusBadge";
import { WorkoutStep } from "@/components/molecules/WorkoutStep";

const steps = [
  ["Warm up", "8:00", "HR 125–145 bpm"],
  ["Run", "12:00", "HR 135–148 bpm"],
  ["Cool down", "5:00", "HR 120–140 bpm"],
];

export function TodayWorkout() {
  return (
    <section className="surface workout-panel" aria-labelledby="today-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Today · Monday</span>
          <h2 id="today-heading">Easy base before Hyrox</h2>
        </div>
        <StatusBadge tone="success">Ready</StatusBadge>
      </div>
      <p className="muted">
        Keep this controlled so the afternoon session stays productive.
      </p>
      <ol className="workout-steps">
        {steps.map(([name, duration, target], index) => (
          <WorkoutStep
            key={name}
            index={index + 1}
            name={name}
            duration={duration}
            target={target}
          />
        ))}
      </ol>
      <div className="action-row">
        <button className="button button-primary" type="button">
          Mark complete
        </button>
        <button className="button button-secondary" type="button">
          Copy Garmin steps
        </button>
      </div>
    </section>
  );
}
