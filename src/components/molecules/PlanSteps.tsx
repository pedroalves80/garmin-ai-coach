import type { PlanStep } from "@/shared/types/metrics";
import { amountText, targetText } from "@/shared/training-plan";

export function PlanSteps({ steps }: { steps: PlanStep[] }) {
  return (
    <ol className="plan-steps">
      {steps.map((step, index) => (
        <li key={index}>
          {step.kind === "repeat" ? (
            <>
              <strong>Repeat {step.times} times</strong>
              <PlanSteps steps={step.steps} />
            </>
          ) : (
            <>
              <div className="step-top">
                <strong>{step.name}</strong>
                <span>{amountText(step)}</span>
              </div>
              <small>{targetText(step.target)}</small>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
