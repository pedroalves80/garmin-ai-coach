import { MetricCard } from "@/components/molecules/MetricCard";
import { TodayWorkout } from "@/components/organisms/TodayWorkout";
import { WeekOverview } from "@/components/organisms/WeekOverview";

export function DashboardTemplate() {
  return <main className="app-shell"><header className="app-header"><div><span className="eyebrow">Personal training system</span><h1>Run coach</h1><p className="muted">Garmin-aware planning for running, Hyrox and cycling.</p></div><button className="avatar" type="button" aria-label="Open settings">PA</button></header><div className="metric-grid"><MetricCard label="This week" value="0 km" detail="of 25 km target" /><MetricCard label="Next quality" value="Thu" detail="Tempo · 2 × 8 min" /><MetricCard label="Recovery" value="Good" detail="No flags yet" /></div><div className="dashboard-grid"><TodayWorkout /><WeekOverview /></div><nav className="bottom-nav" aria-label="Primary navigation"><a className="active" href="#today">Today</a><a href="#week">Week</a><a href="#progress">Progress</a><a href="#coach">Coach</a></nav></main>;
}
