import type { GarminStatus } from "@/shared/types/sync";

export function AutoSyncSummary({ status }: { status: GarminStatus | null }) {
  if (!status)
    return <p className="muted small-text">Checking automatic sync…</p>;
  const auto = status.automatic;
  const label = !auto.enabled
    ? "Automatic sync disabled"
    : !status.configured
      ? "Automatic sync needs a Garmin key"
      : !auto.workerOnline
        ? "Automatic sync worker offline"
        : status.running
          ? "Garmin sync in progress"
          : auto.failures > 0
            ? "Automatic sync waiting to retry"
            : "Automatic sync active · every 3 hours";
  return (
    <div className="auto-sync-summary">
      <p>
        <strong>{label}</strong>
      </p>
      {auto.enabled &&
        status.configured &&
        auto.workerOnline &&
        auto.nextRunAt &&
        !status.running && (
          <p className="muted small-text">
            Next attempt:{" "}
            {new Date(auto.nextRunAt).toLocaleString("en-GB", {
              timeZone: "Europe/Lisbon",
            })}{" "}
            Lisbon · checked every 30 seconds.
          </p>
        )}
      {auto.enabled && !auto.workerOnline && (
        <p className="muted small-text">
          Start the worker with the app or Docker Compose. Manual sync is
          available below.
        </p>
      )}
      {!!auto.lastError && auto.enabled && (
        <p className="error-text small-text">
          Automatic sync: {auto.lastError}
        </p>
      )}
    </div>
  );
}
