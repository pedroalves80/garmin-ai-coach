"use client";
import { useState } from "react";
import type { TrainingDashboardData } from "@/server/training/dashboard";
import type { DashboardData } from "@/server/dashboard/data";
import { TrainingMetrics } from "./TrainingMetrics";
import { ActivityHistory } from "./ActivityHistory";
export function ProgressWorkspace({
  data,
  activities,
}: {
  data: TrainingDashboardData;
  activities: DashboardData["activities"];
}) {
  const [view, setView] = useState("trends");
  return (
    <div className="screen-stack">
      <div
        className="segmented-control"
        role="group"
        aria-label="Progress view"
      >
        <button
          aria-pressed={view === "trends"}
          onClick={() => setView("trends")}
        >
          Training trends
        </button>
        <button
          aria-pressed={view === "activities"}
          onClick={() => setView("activities")}
        >
          Recent activities
        </button>
      </div>
      {view === "trends" ? (
        <TrainingMetrics data={data} />
      ) : (
        <ActivityHistory activities={activities} />
      )}
    </div>
  );
}
