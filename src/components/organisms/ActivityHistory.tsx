import type { DashboardData } from "@/server/dashboard/data";

export function ActivityHistory({
  activities,
}: {
  activities: DashboardData["activities"];
}) {
  return (
    <section
      className="surface"
      id="activities"
      aria-labelledby="activity-heading"
    >
      <h2 id="activity-heading">Recent activities</h2>
      {!activities.length ? (
        <p className="muted">Sync Garmin to see your recent sessions.</p>
      ) : (
        <ul className="activity-list">
          {activities.map((activity) => (
            <li key={activity.id}>
              <div>
                <strong>
                  {activity.name || activity.sportType.replaceAll("_", " ")}
                </strong>
                <small>
                  {new Date(activity.startedAt).toLocaleString("en-GB", {
                    timeZone: "Europe/Lisbon",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  · {activity.sportType.replaceAll("_", " ")}
                </small>
              </div>
              <div className="activity-stats">
                <span>
                  {activity.distanceMeters == null
                    ? "—"
                    : `${(activity.distanceMeters / 1000).toFixed(2)} km`}
                </span>
                <span>
                  {activity.durationSeconds == null
                    ? "—"
                    : `${Math.round(activity.durationSeconds / 60)} min`}
                </span>
                <span>
                  {activity.averageHeartRate
                    ? `${Math.round(activity.averageHeartRate)} bpm`
                    : "HR unavailable"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
