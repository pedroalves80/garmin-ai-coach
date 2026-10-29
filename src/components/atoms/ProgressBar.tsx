type ProgressBarProps = { value: number; max: number; label: string };

export function ProgressBar({ value, max, label }: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="progress-wrap" aria-label={`${label}: ${value} of ${max}`}>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percentage}%` }} />
      </div>
      <span className="progress-label">{label}</span>
    </div>
  );
}
