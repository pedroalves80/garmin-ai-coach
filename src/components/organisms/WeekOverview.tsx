import { ProgressBar } from "@/components/atoms/ProgressBar";
import { StatusBadge } from "@/components/atoms/StatusBadge";

const sessions = [["Mon", "Easy base + Hyrox", "12 min run"], ["Tue", "Easy + strides", "6 × 20 sec"], ["Thu", "Tempo", "2 × 8 min"], ["Sat", "Long easy", "50 min"]];

export function WeekOverview() {
  return <section className="surface" aria-labelledby="week-heading"><div className="section-heading"><div><span className="eyebrow">Current block</span><h2 id="week-heading">Week 1 · 25 km target</h2></div><StatusBadge>Build</StatusBadge></div><ProgressBar value={0} max={25} label="0 / 25 km completed" /><div className="session-list">{sessions.map(([day, title, detail]) => <div className="session-row" key={day}><span className="session-day">{day}</span><span><strong>{title}</strong><small>{detail}</small></span><span className="muted">Planned</span></div>)}</div></section>;
}
