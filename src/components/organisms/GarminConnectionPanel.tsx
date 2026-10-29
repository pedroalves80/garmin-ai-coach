"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/atoms/StatusBadge";
import { Button } from "@/components/atoms/Button";

type Props = {
  configured: boolean;
  lastSync: string | null;
  lastError: string | null;
};

export function GarminConnectionPanel({
  configured,
  lastSync,
  lastError,
}: Props) {
  const router = useRouter();
  const [full, setFull] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function sync(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailed(false);
    setMessage("Syncing with Garmin…");
    try {
      const response = await fetch(
        `/api/garmin/sync${full ? "?full=true" : ""}`,
        {
          method: "POST",
          headers: { "x-coach-request": "local" },
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Sync failed. Retry later.");
      setMessage(
        `Synced ${result.importedActivities} activities and ${result.healthDays} health days.`,
      );
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="surface"
      id="connection"
      aria-labelledby="connection-heading"
    >
      <div className="section-heading">
        <h2 id="connection-heading">Garmin Connect</h2>
        <StatusBadge tone={configured ? "success" : "warning"}>
          {configured ? "Configured" : "Setup needed"}
        </StatusBadge>
      </div>
      <p className="muted">
        {lastSync
          ? `Last sync: ${new Date(lastSync).toLocaleString("en-GB", { timeZone: "Europe/Lisbon" })}`
          : "No sync yet. Your activities and health data will appear here."}
      </p>
      {lastError && <p className="error-text">Last sync: {lastError}</p>}
      {configured ? (
        <form onSubmit={sync} className="sync-form">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={full}
              onChange={(e) => setFull(e.target.checked)}
            />
            Recheck the last 90 days
          </label>
          <Button disabled={pending} type="submit">
            {pending ? "Syncing…" : "Sync Garmin"}
          </Button>
        </form>
      ) : (
        <p className="muted">
          Add your Garmin personal key to the server environment, then restart.
          See the project README for setup.
        </p>
      )}
      <p
        role={failed ? "alert" : "status"}
        aria-live="polite"
        className={failed ? "error-text" : "muted"}
      >
        {message}
      </p>
    </section>
  );
}
