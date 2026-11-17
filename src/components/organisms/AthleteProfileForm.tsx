"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AthleteProfile } from "@/shared/types/athlete";
import { formatPace } from "@/shared/training-plan";
import { Button } from "../atoms/Button";
function pace(value: string) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}
export function AthleteProfileForm({
  initial,
  today,
}: {
  initial: AthleteProfile;
  today: string;
}) {
  const router = useRouter(),
    [profile, setProfile] = useState(initial),
    [easy, setEasy] = useState(formatPace(initial.easyPace)),
    [tempo, setTempo] = useState(formatPace(initial.tempoPace)),
    [strideMin, setStrideMin] = useState(formatPace(initial.targets.strideMin)),
    [strideMax, setStrideMax] = useState(formatPace(initial.targets.strideMax)),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  return (
    <details className="surface supporting-details">
      <summary>Running targets & fitness review</summary>
      <form
        className="screen-stack athlete-profile-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setMessage("");
          try {
            const next = {
              ...profile,
              easyPace: pace(easy),
              tempoPace: pace(tempo),
              targets: {
                ...profile.targets,
                strideMin: pace(strideMin),
                strideMax: pace(strideMax),
              },
            };
            const response = await fetch("/api/training/athlete", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-coach-request": "local",
              },
              body: JSON.stringify({ action: "profile", profile: next }),
            });
            const result = await response.json();
            if (!response.ok)
              throw new Error(
                result.error ?? "Could not save running targets.",
              );
            setMessage(
              "Running targets saved. New drafts use these ranges; review and save an updated week to change approved workouts.",
            );
            router.refresh();
          } catch (error) {
            setMessage(
              error instanceof Error
                ? error.message
                : "Could not save running targets.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <p className="muted small-text">
          Focus: durable aerobic running, faster pace at comparable HR and
          sustainable volume. The 80 km milestone remains a ceiling. Provisional
          targets are preferences; confirming a review records your evidence,
          not a lab validation by the app. Review targets periodically rather
          than lowering HR targets every week.
        </p>
        <div className="training-form editor-fields">
          {[
            {
              id: "athlete-easy",
              label: "Planning pace · min:sec/km",
              value: easy,
              set: setEasy,
            },
            {
              id: "athlete-tempo",
              label: "Tempo working pace · min:sec/km",
              value: tempo,
              set: setTempo,
            },
            {
              id: "stride-min",
              label: "Stride faster bound · min:sec/km",
              value: strideMin,
              set: setStrideMin,
            },
            {
              id: "stride-max",
              label: "Stride slower bound · min:sec/km",
              value: strideMax,
              set: setStrideMax,
            },
          ].map((field) => (
            <label key={field.id} htmlFor={field.id}>
              {field.label}
              <input
                id={field.id}
                required
                pattern="[0-9]{1,2}:[0-5][0-9]"
                value={field.value}
                onChange={(e) => field.set(e.target.value)}
              />
            </label>
          ))}
          {(
            [
              "baseMin",
              "baseMax",
              "recoveryMin",
              "recoveryMax",
              "longMin",
              "longMax",
            ] as const
          ).map((key) => (
            <label key={key} htmlFor={`hr-${key}`}>
              {
                {
                  baseMin: "Base HR lower",
                  baseMax: "Base HR upper",
                  recoveryMin: "Recovery HR lower",
                  recoveryMax: "Recovery HR upper",
                  longMin: "Long-run HR lower",
                  longMax: "Long-run HR upper",
                }[key]
              }{" "}
              · bpm
              <input
                id={`hr-${key}`}
                type="number"
                min="80"
                max="210"
                required
                value={profile.targets[key]}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    targets: {
                      ...profile.targets,
                      [key]: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
          <label htmlFor="calibration-source">
            Target evidence
            <select
              id="calibration-source"
              value={profile.calibrationSource}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  calibrationSource: e.target
                    .value as AthleteProfile["calibrationSource"],
                  reviewedAt:
                    e.target.value === "provisional"
                      ? null
                      : (profile.reviewedAt ?? today),
                })
              }
            >
              <option value="provisional">Provisional · needs review</option>
              <option value="field_test">
                Field test / performance review
              </option>
              <option value="lab_test">Lab assessment</option>
              <option value="coach_review">Coach review</option>
            </select>
          </label>
          <label htmlFor="calibration-date">
            Reviewed on
            <input
              id="calibration-date"
              type="date"
              max={today}
              required={profile.calibrationSource !== "provisional"}
              disabled={profile.calibrationSource === "provisional"}
              value={profile.reviewedAt ?? ""}
              onChange={(e) =>
                setProfile({ ...profile, reviewedAt: e.target.value || null })
              }
            />
          </label>
        </div>
        <label htmlFor="calibration-evidence">
          Review evidence · kept locally
          <textarea
            id="calibration-evidence"
            minLength={profile.calibrationSource === "provisional" ? 0 : 5}
            maxLength={300}
            required={profile.calibrationSource !== "provisional"}
            value={profile.evidence}
            onChange={(e) =>
              setProfile({ ...profile, evidence: e.target.value })
            }
          />
        </label>
        <p className="muted small-text">
          Faster pace or higher HR targets need a target review within six
          weeks. Tempo distance can grow at the existing pace from repeated
          recorded quality-day runs and recovery evidence; effort ratings stay
          optional. Strides stay controlled and relaxed. Review faster targets
          at steady volume.
        </p>
        <div>
          <Button disabled={pending}>Save running targets</Button>
        </div>
        {message && (
          <p role="status" className="small-text">
            {message}
          </p>
        )}
      </form>
    </details>
  );
}
