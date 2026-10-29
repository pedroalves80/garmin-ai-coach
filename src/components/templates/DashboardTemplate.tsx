import { MetricCard } from "@/components/molecules/MetricCard";
import { ActivityHistory } from "@/components/organisms/ActivityHistory";
import { GarminConnectionPanel } from "@/components/organisms/GarminConnectionPanel";
import type { DashboardData } from "@/server/dashboard/data";

export function DashboardTemplate({
  data,
  configured,
}: {
  data: DashboardData;
  configured: boolean;
}) {
  const hasSync = Boolean(data.lastSync?.lastCompletedAt);
  const sleep = data.health?.sleepSeconds;
  return (
    <main className="app-shell" id="overview">
      <header className="app-header">
        <div>
          <span className="eyebrow">Personal training system</span>
          <h1>Run coach</h1>
          <p className="muted">
            Running, Hyrox and cycling. Week of {data.weekStart} ·
            Europe/Lisbon.
          </p>
        </div>
      </header>
      <div className="metric-grid">
        <MetricCard
          label="Running this week"
          value={hasSync ? `${data.runningKm.toFixed(1)} km` : "—"}
          detail={
            hasSync
              ? `${data.runningCount} runs · since Monday`
              : "Awaiting Garmin sync"
          }
        />
        <MetricCard
          label="All training"
          value={hasSync ? `${Math.round(data.trainingMinutes)} min` : "—"}
          detail="All recorded sports this week"
        />
        <MetricCard
          label="Latest sleep"
          value={sleep == null ? "—" : `${(sleep / 3600).toFixed(1)} h`}
          detail={data.health?.day ?? "Awaiting health data"}
        />
      </div>
      <div className="dashboard-grid">
        <ActivityHistory activities={data.activities} />
        <div className="dashboard-stack">
          <GarminConnectionPanel
            configured={configured}
            lastSync={data.lastSync?.lastCompletedAt ?? null}
            lastError={data.lastSync?.lastError ?? null}
          />
          <section className="surface" aria-labelledby="health-heading">
            <h2 id="health-heading">Latest health data</h2>
            <p className="muted">
              {data.health?.day ?? "No health data synced"}
            </p>
            <dl className="health-values">
              <div>
                <dt>Resting HR</dt>
                <dd>
                  {data.health?.restingHeartRate
                    ? `${data.health.restingHeartRate} bpm`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Body Battery · latest daily value</dt>
                <dd>{data.health?.bodyBattery ?? "—"}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
      <p className="attribution muted">
        Data provided by Garmin devices. Values reflect the last successful
        sync. Coaching and plan adaptation are still under development.
      </p>
      <nav className="bottom-nav" aria-label="Primary navigation">
        <a href="#overview">Overview</a>
        <a href="#activities">Activities</a>
        <a href="#connection">Garmin</a>
      </nav>
    </main>
  );
}
