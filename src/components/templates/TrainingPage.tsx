import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader } from "@/components/molecules/PageHeader";
import { dashboardData } from "@/server/dashboard/data";
import { trainingDashboardData } from "@/server/training/dashboard";
import { getConfig } from "@/server/config";
import { TodayOverview } from "@/components/organisms/TodayOverview";
import { TrainingWorkspace } from "@/components/organisms/TrainingWorkspace";
import { ProgressWorkspace } from "@/components/organisms/ProgressWorkspace";
import { CoachPanel } from "@/components/organisms/CoachPanel";
import { TrainingPreferencesForm } from "@/components/organisms/TrainingPreferencesForm";
import { ScheduleRepository } from "@/server/training/schedule-repository";
import { getDatabase } from "@/server/db/client";
import { GarminConnectionPanel } from "@/components/organisms/GarminConnectionPanel";

type View = "today" | "plan" | "coach" | "progress" | "settings";
const pages = {
  today: {
    eyebrow: "YOUR DAILY OVERVIEW",
    title: "Your training, today.",
    description: "Your sessions, recovery and week so far.",
  },
  plan: {
    eyebrow: "MAKE A LITTLE ROOM FOR PROGRESS",
    title: "Your training week.",
    description: "Pick a day. See the steps. Make it yours in Garmin.",
  },
  coach: {
    eyebrow: "A SECOND PAIR OF EYES",
    title: "Your AI coach.",
    description: "Practical guidance from your training and recovery.",
  },
  progress: {
    eyebrow: "THE BIGGER PICTURE",
    title: "See what’s changing.",
    description: "Your running, consistency and recent activities.",
  },
  settings: {
    eyebrow: "CONNECTED & IN YOUR CONTROL",
    title: "Your workspace.",
    description: "Manage your Garmin connection and automatic syncing.",
  },
};
async function Content({ view }: { view: View }) {
  await connection();
  if (view === "coach") return <CoachPanel />;
  if (view === "settings") {
    const data = dashboardData(),
      config = getConfig();
    return (
      <div className="settings-layout">
        <GarminConnectionPanel
          configured={!!config.GARMIN_PERSONAL_API_KEY}
          lastSync={data.lastSync?.lastCompletedAt ?? null}
          lastError={data.lastSync?.lastError ?? null}
        />
        <TrainingPreferencesForm
          initial={new ScheduleRepository(getDatabase()).preferences()}
        />
        <section className="surface">
          <span className="eyebrow">YOUR PERSONAL WORKSPACE</span>
          <h2>Built around your training.</h2>
          <p className="muted">
            Running, Hyrox and cycling, with weeks starting Monday in
            Europe/Lisbon.
          </p>
          <details className="supporting-details">
            <summary>Data & AI privacy</summary>
            <p className="muted small-text">
              Garmin data is stored on this server. AI reviews send compact
              training and health summaries to OpenAI for manual reviews and the
              optional daily automatic recommendation. GPS, activity names and
              check-in notes stay local.
            </p>
          </details>
        </section>
      </div>
    );
  }
  const training = trainingDashboardData();
  if (view === "plan") return <TrainingWorkspace data={training} />;
  const data = dashboardData();
  return view === "progress" ? (
    <ProgressWorkspace data={training} activities={data.activities} />
  ) : (
    <TodayOverview data={data} training={training} />
  );
}
export function TrainingPage({ view }: { view: View }) {
  return (
    <>
      <PageHeader {...pages[view]} />
      <Suspense
        fallback={
          <div className="surface loading-state" role="status">
            Loading your training…
          </div>
        }
      >
        <Content view={view} />
      </Suspense>
      <footer className="page-footer">
        Personal training, at your pace.
        <span>Data from Garmin · Europe/Lisbon</span>
      </footer>
    </>
  );
}
