"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TrainingDashboardData } from "@/server/training/dashboard";
import { planDayHref } from "@/shared/week-view";
import { RacePacingEvidenceForm } from "./RacePacingEvidenceForm";
import { TrainingCalendarManager } from "./TrainingCalendarManager";
export function EventsWorkspace({ data }: { data: TrainingDashboardData }) {
  const router = useRouter();
  return (
    <section className="screen-stack" aria-label="Events and training breaks">
      <Link href="/plan" className="text-link">
        ← Back to Plan
      </Link>
      <RacePacingEvidenceForm today={data.today} evidence={data.paceEvidence} />
      <TrainingCalendarManager
        data={data}
        onView={(day) => router.push(planDayHref(day))}
      />
    </section>
  );
}
