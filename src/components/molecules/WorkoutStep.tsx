type WorkoutStepProps = { index: number; name: string; duration: string; target: string };

export function WorkoutStep({ index, name, duration, target }: WorkoutStepProps) {
  return <li className="workout-step"><span className="step-number">{index}</span><span><strong>{name}</strong><small>{target}</small></span><time>{duration}</time></li>;
}
