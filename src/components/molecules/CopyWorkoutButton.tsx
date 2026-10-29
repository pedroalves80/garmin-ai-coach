"use client";
import { useState } from "react";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import { garminWorkoutText } from "@/shared/training-plan";
import type { RunWorkout } from "@/shared/types/metrics";

export function CopyWorkoutButton({ workout }: { workout: RunWorkout }) {
  const text = garminWorkoutText(workout);
  const [notice, setNotice] = useState<{
    identity: string;
    failed: boolean;
    message: string;
  } | null>(null);
  return (
    <div>
      <Button
        className="copy-workout"
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setNotice({
              identity: text,
              failed: false,
              message: "Garmin steps copied.",
            });
          } catch {
            setNotice({
              identity: text,
              failed: true,
              message:
                "Clipboard unavailable. Copy the steps displayed above manually.",
            });
          }
        }}
      >
        Copy Garmin steps <Icon name="arrow" />
      </Button>
      {notice?.identity === text && (
        <p
          className={`${notice.failed ? "error-text" : "success-text"} copy-notice small-text`}
          role={notice.failed ? "alert" : "status"}
        >
          {notice.message}
        </p>
      )}
    </div>
  );
}
