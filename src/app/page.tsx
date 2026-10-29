import { DashboardTemplate } from "@/components/templates/DashboardTemplate";
import { Suspense } from "react";
import { connection } from "next/server";
import { dashboardData } from "@/server/dashboard/data";
import { getGarminConfig } from "@/server/config";
import { trainingDashboardData } from "@/server/training/dashboard";

async function Dashboard() {
  await connection();
  const config = getGarminConfig();
  return (
    <DashboardTemplate
      data={dashboardData()}
      training={trainingDashboardData()}
      configured={Boolean(config.GARMIN_PERSONAL_API_KEY && config.SYNC_SECRET)}
    />
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="app-shell" aria-busy="true">
          Loading your training data…
        </main>
      }
    >
      <Dashboard />
    </Suspense>
  );
}
