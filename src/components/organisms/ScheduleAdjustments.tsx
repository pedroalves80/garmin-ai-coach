"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ChangeReason,
  ScheduleEdit,
  ScheduleEditCatalog,
  ScheduleEditPreview,
  TrainingSlot,
} from "@/shared/types/rescheduling";
import type { ScheduledDay, SessionState } from "@/shared/types/schedule";
import { Button } from "../atoms/Button";
import { ScheduleChangePreview } from "../molecules/ScheduleChangePreview";
import { ScheduleChangeHistory } from "../molecules/ScheduleChangeHistory";
import {
  dateLabel,
  sessionLabel,
  slotLabels,
  reasons,
} from "../molecules/schedule-change-labels";

const slots: TrainingSlot[] = ["morning", "lunch", "later"];
function weekStart(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function editable({ session, status }: SessionState) {
  return (
    !!session.id &&
    status !== "recorded" &&
    session.slot !== "event" &&
    !(
      session.sport === "running" &&
      (session.workout.race || session.workout.type === "race")
    )
  );
}

function movementRestriction(
  entry: SessionState | undefined,
  source: ScheduledDay | undefined,
): string | null {
  if (!entry) return "Choose a workout";
  if (entry.session.sport === "hyrox")
    return "Hyrox has a fixed class date; change attendance in Plan";
  if (entry.status !== "planned")
    return "Blocked workout; skip or review recorded activities";
  if (source?.rule || source?.race)
    return "Protected calendar date; review the commitment";
  if (source?.dayOffset === 6) return "Sunday remains rest";
  return null;
}

async function request<T>(
  body?: object,
  signal?: AbortSignal,
  week?: string,
): Promise<T> {
  const response = await fetch(
    `/api/training/adjustments${body ? "" : `?week=${encodeURIComponent(week ?? "")}`}`,
    {
      method: body ? "POST" : "GET",
      cache: "no-store",
      signal,
      headers: {
        "x-coach-request": "local",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body
        ? {
            body: JSON.stringify(body),
          }
        : {}),
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.error) {
    throw new Error(
      result?.error ?? "Schedule changes are unavailable. Please try again.",
    );
  }
  return result as T;
}

export function ScheduleAdjustments({ day }: { day: string }) {
  return <AdjustmentPanel key={day} day={day} />;
}

function AdjustmentPanel({ day }: { day: string }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [applying, setApplying] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="schedule-adjustments">
      <button
        ref={trigger}
        type="button"
        className="button button-secondary"
        aria-expanded={open}
        aria-controls={id}
        disabled={applying}
        onClick={() => {
          setOpen(!open);
          setSaved(false);
        }}
      >
        {open ? "Close workout changes" : "Change workout"}
      </button>
      {saved && (
        <p className="success-text small-text" role="status">
          Schedule change saved.
        </p>
      )}
      {open && (
        <div id={id} className="adjustment-panel">
          <AdjustmentEditor
            day={day}
            onApplying={setApplying}
            onClose={(applied = false) => {
              setOpen(false);
              setSaved(applied);
              requestAnimationFrame(() => trigger.current?.focus());
            }}
          />
        </div>
      )}
    </div>
  );
}

function AdjustmentEditor({
  day,
  onClose,
  onApplying,
}: {
  day: string;
  onClose: (applied?: boolean) => void;
  onApplying: (value: boolean) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [catalog, setCatalog] = useState<ScheduleEditCatalog | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<
    "preview" | "suggest" | "apply" | null
  >(null);
  const [tab, setTab] = useState<"workout" | "availability" | "history">(
    "workout",
  );
  const [sessionId, setSessionId] = useState("");
  const [action, setAction] = useState<"move" | "swap" | "skip" | "terrain">(
    "move",
  );
  const [terrain, setTerrain] = useState<"road" | "trail">("trail");
  const [trailMinutes, setTrailMinutes] = useState("");
  const [ascent, setAscent] = useState("");
  const [toDay, setToDay] = useState(day);
  const [toSlot, setToSlot] = useState<TrainingSlot>("morning");
  const [withSessionId, setWithSessionId] = useState("");
  const [reason, setReason] = useState<ChangeReason>("unavailable");
  const [availabilityDay, setAvailabilityDay] = useState(day);
  const [blockedSlots, setBlockedSlots] = useState<TrainingSlot[]>([]);
  const [preview, setPreview] = useState<ScheduleEditPreview | null>(null);
  const operation = useRef<AbortController | null>(null);
  const applyLock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    request<ScheduleEditCatalog>(undefined, controller.signal, weekStart(day))
      .then((data) => {
        if (controller.signal.aborted) return;
        setCatalog(data);
        const entry = data.days
          .find((d) => d.day === day && d.day >= data.today)
          ?.sessions.find(editable);
        setSessionId(entry?.session.id ?? "");
        if (
          entry &&
          movementRestriction(
            entry,
            data.days.find((d) => d.day === day),
          )
        )
          setAction("skip");
        setToSlot(
          entry?.session.slot === "lunch" || entry?.session.slot === "later"
            ? entry.session.slot
            : "morning",
        );
        const availableDay =
          data.days.find((d) => d.day === day && d.day >= data.today)?.day ??
          data.days.find((d) => d.day >= data.today)?.day ??
          "";
        setAvailabilityDay(availableDay);
        setBlockedSlots(
          data.availability.find((block) => block.day === availableDay)
            ?.slots ?? [],
        );
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load your schedule.",
          );
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      operation.current?.abort();
    };
  }, [day, reload]);

  function clearPreview() {
    operation.current?.abort();
    setPreview(null);
    setError("");
    setPending(null);
  }

  async function getPreview(
    change:
      | ScheduleEdit
      | {
          mode: "suggest";
          day: string;
          sessionId: string;
          reason: ChangeReason;
        },
  ) {
    clearPreview();
    const controller = new AbortController();
    operation.current = controller;
    setPending("mode" in change ? "suggest" : "preview");
    try {
      const result = await request<ScheduleEditPreview>(
        "mode" in change ? change : { mode: "preview", change },
        controller.signal,
      );
      if (!controller.signal.aborted) setPreview(result);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not preview this change.",
        );
    } finally {
      if (!controller.signal.aborted) setPending(null);
    }
  }

  async function apply() {
    if (!preview || applyLock.current) return;
    applyLock.current = true;
    onApplying(true);
    setPending("apply");
    setError("");
    try {
      const result = await request<{ saved: true }>({
        mode: "apply",
        change: preview.request,
        revision: preview.revision,
      });
      if (!result.saved)
        throw new Error("The change was not saved. Please preview it again.");
      router.refresh();
      onClose(true);
    } catch (cause) {
      setPreview(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not apply this change. Please preview it again.",
      );
    } finally {
      applyLock.current = false;
      onApplying(false);
      setPending(null);
    }
  }

  const sourceSessions =
    catalog?.days
      .find((d) => d.day === day && d.day >= catalog.today)
      ?.sessions.filter(editable) ?? [];
  const futureDays = catalog?.days.filter((d) => d.day >= catalog.today) ?? [];
  const selected = sourceSessions.find(
    (entry) => entry.session.id === sessionId,
  );
  const swapSessions =
    futureDays
      .find((d) => d.day === toDay)
      ?.sessions.filter(
        (entry) => editable(entry) && entry.session.id !== sessionId,
      ) ?? [];
  const sourceDay = catalog?.days.find((d) => d.day === day);
  const targetDay = futureDays.find((d) => d.day === toDay);
  const movementIssue = movementRestriction(selected, sourceDay);
  function destinationRestriction(target: ScheduledDay): string | null {
    if (target.dayOffset === 6) return "Sunday rest";
    if (target.rule || target.race) return "Protected calendar date";
    if (target.unavailableSlots?.length === 3) return "Unavailable all day";
    if (action === "swap" && target.day === day) return "Choose another date";
    if (
      selected &&
      target.recorded.some((record) => record.sport === selected.session.sport)
    )
      return "This sport already recorded";
    const remaining = target.sessions.filter(
      (entry) => entry.session.id !== sessionId,
    );
    if (
      action === "move" &&
      remaining.some((entry) => entry.session.sport === selected?.session.sport)
    )
      return "This sport already scheduled";
    if (
      action === "move" &&
      target.recorded.length +
        remaining.filter((entry) => entry.status !== "recorded").length >=
        2
    )
      return "Two workouts already scheduled or recorded";
    return null;
  }
  function slotRestriction(slot: TrainingSlot): string | null {
    if (targetDay?.unavailableSlots?.includes(slot)) return "Unavailable";
    if (
      targetDay?.sessions.some(
        (entry) =>
          entry.session.id !== sessionId && entry.session.slot === slot,
      )
    )
      return "Occupied";
    if (toDay === day && selected?.session.slot === slot) return "Current time";
    return null;
  }
  const swapEntry = swapSessions.find(
    (entry) => entry.session.id === withSessionId,
  );
  const busy = pending !== null;
  const canChangeTerrain =
    !movementIssue &&
    selected?.session.sport === "running" &&
    selected.session.workout.type === "long";
  const validWorkout =
    !!selected &&
    (action === "terrain"
      ? canChangeTerrain &&
        (terrain === "road"
          ? !!(
              selected?.session.sport === "running" &&
              selected.session.workout.trail?.road
            )
          : Number(trailMinutes) >= 15 &&
            Number(trailMinutes) <= 1440 &&
            (ascent === "" || (Number(ascent) >= 0 && Number(ascent) <= 10000)))
      : action === "skip" ||
        (!movementIssue &&
          !!targetDay &&
          !destinationRestriction(targetDay) &&
          (action === "swap"
            ? !!swapEntry && !movementRestriction(swapEntry, targetDay)
            : !slotRestriction(toSlot))));

  function previewWorkout() {
    if (!validWorkout) return;
    const base = { day, sessionId, reason };
    const change: ScheduleEdit =
      action === "terrain"
        ? {
            ...base,
            action,
            terrain,
            reason: "other",
            ...(terrain === "trail"
              ? {
                  expectedMinutes: Number(trailMinutes),
                  ...(ascent !== "" ? { ascentM: Number(ascent) } : {}),
                }
              : {}),
          }
        : action === "move"
          ? { ...base, action, toDay, toSlot }
          : action === "swap"
            ? { ...base, action, withDay: toDay, withSessionId }
            : { ...base, action };
    void getPreview(change);
  }

  const reasonField = (
    <label htmlFor={`${id}-reason`}>
      Reason
      <select
        id={`${id}-reason`}
        value={reason}
        onChange={(event) => {
          clearPreview();
          setReason(event.target.value as ChangeReason);
        }}
      >
        {Object.entries(reasons).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section aria-labelledby={`${id}-heading`} aria-busy={loading || busy}>
      <div className="section-heading">
        <div>
          <h3 id={`${id}-heading`}>Adjust your schedule</h3>
          <p className="muted small-text">
            {dateLabel(day)} · Review every change before applying.
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          disabled={pending === "apply"}
          onClick={() => onClose()}
        >
          Close
        </button>
      </div>
      {loading && (
        <p className="muted small-text" role="status">
          Loading your saved schedule…
        </p>
      )}
      {error && (
        <p className="error-text small-text" role="alert">
          {error}
        </p>
      )}
      {!loading && !catalog && (
        <Button
          type="button"
          onClick={() => {
            setError("");
            setLoading(true);
            setReload(reload + 1);
          }}
        >
          Try again
        </Button>
      )}
      {catalog && (
        <>
          <div
            className="adjustment-tabs"
            role="group"
            aria-label="Schedule change type"
          >
            {(["workout", "availability", "history"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                disabled={pending === "apply"}
                onClick={() => {
                  clearPreview();
                  setTab(value);
                }}
              >
                {value === "workout"
                  ? "Workout"
                  : value === "availability"
                    ? "Availability"
                    : "Recent changes"}
              </button>
            ))}
          </div>
          {tab === "workout" &&
            (sourceSessions.length ? (
              <form
                className="adjustment-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  previewWorkout();
                }}
              >
                <fieldset disabled={busy}>
                  <legend className="sr-only">Workout change</legend>
                  <label htmlFor={`${id}-session`}>
                    Workout
                    <select
                      id={`${id}-session`}
                      value={sessionId}
                      onChange={(event) => {
                        clearPreview();
                        setSessionId(event.target.value);
                        if (
                          movementRestriction(
                            sourceSessions.find(
                              (entry) =>
                                entry.session.id === event.target.value,
                            ),
                            sourceDay,
                          )
                        )
                          setAction("skip");
                        setWithSessionId("");
                      }}
                    >
                      {sourceSessions.map((entry) => (
                        <option key={entry.session.id} value={entry.session.id}>
                          {sessionLabel(entry)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="adjustment-fields">
                    <label htmlFor={`${id}-action`}>
                      Change
                      <select
                        id={`${id}-action`}
                        value={action}
                        onChange={(event) => {
                          clearPreview();
                          setAction(event.target.value as typeof action);
                          setWithSessionId("");
                        }}
                      >
                        <option value="move" disabled={!!movementIssue}>
                          Move workout
                          {movementIssue
                            ? " · unavailable for this workout"
                            : ""}
                        </option>
                        <option value="swap" disabled={!!movementIssue}>
                          Swap workouts
                          {movementIssue
                            ? " · unavailable for this workout"
                            : ""}
                        </option>
                        <option value="terrain" disabled={!canChangeTerrain}>
                          Road / trail long run
                        </option>
                        <option value="skip">Skip workout</option>
                      </select>
                    </label>
                    {action !== "terrain" && reasonField}
                    {action === "terrain" && (
                      <>
                        <label htmlFor={`${id}-terrain`}>
                          Surface
                          <select
                            id={`${id}-terrain`}
                            value={terrain}
                            onChange={(e) => {
                              clearPreview();
                              setTerrain(e.target.value as "road" | "trail");
                            }}
                          >
                            <option value="trail">Trail · RPE 3–4/10</option>
                            <option value="road">
                              Road · restore original targets
                            </option>
                          </select>
                        </label>
                        {terrain === "trail" && (
                          <>
                            <label htmlFor={`${id}-trail-minutes`}>
                              Estimated total minutes, including hiking
                              <input
                                id={`${id}-trail-minutes`}
                                type="number"
                                min="15"
                                max="1440"
                                step="1"
                                required
                                value={trailMinutes}
                                onChange={(e) => {
                                  clearPreview();
                                  setTrailMinutes(e.target.value);
                                }}
                              />
                            </label>
                            <label htmlFor={`${id}-ascent`}>
                              Estimated ascent (metres, optional)
                              <input
                                id={`${id}-ascent`}
                                type="number"
                                min="0"
                                max="10000"
                                step="1"
                                value={ascent}
                                onChange={(e) => {
                                  clearPreview();
                                  setAscent(e.target.value);
                                }}
                              />
                            </label>
                          </>
                        )}
                      </>
                    )}
                    {action !== "skip" && action !== "terrain" && (
                      <label htmlFor={`${id}-destination`}>
                        Destination day
                        <select
                          id={`${id}-destination`}
                          required
                          value={toDay}
                          onChange={(event) => {
                            clearPreview();
                            setToDay(event.target.value);
                            setWithSessionId("");
                          }}
                        >
                          {futureDays.map((d) => (
                            <option
                              key={d.day}
                              value={d.day}
                              disabled={!!destinationRestriction(d)}
                            >
                              {dateLabel(d.day)}
                              {destinationRestriction(d)
                                ? ` · ${destinationRestriction(d)}`
                                : d.day === day
                                  ? " · same day"
                                  : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {action === "move" && (
                      <label htmlFor={`${id}-slot`}>
                        Time of day
                        <select
                          id={`${id}-slot`}
                          value={toSlot}
                          onChange={(event) => {
                            clearPreview();
                            setToSlot(event.target.value as TrainingSlot);
                          }}
                        >
                          {slots.map((slot) => (
                            <option
                              key={slot}
                              value={slot}
                              disabled={!!slotRestriction(slot)}
                            >
                              {slotLabels[slot]}
                              {slotRestriction(slot)
                                ? ` · ${slotRestriction(slot)}`
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {action === "swap" && (
                      <label htmlFor={`${id}-swap`}>
                        Swap with
                        <select
                          id={`${id}-swap`}
                          required
                          value={withSessionId}
                          onChange={(event) => {
                            clearPreview();
                            setWithSessionId(event.target.value);
                          }}
                        >
                          <option value="">Choose a workout</option>
                          {swapSessions.map((entry) => (
                            <option
                              key={entry.session.id}
                              value={entry.session.id}
                              disabled={!!movementRestriction(entry, targetDay)}
                            >
                              {sessionLabel(entry)}
                              {movementRestriction(entry, targetDay)
                                ? ` · ${movementRestriction(entry, targetDay)}`
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {action === "terrain" && (
                    <p className="inline-notice small-text">
                      Same kilometres and distance steps. Trail uses RPE 3–4/10
                      and Garmin “No Target”; HR is feedback, not a narrow
                      alert. Hike steep climbs and control descents. Time and
                      ascent inform load review; they are estimates, not workout
                      targets. Choose familiar terrain first and build
                      difficulty separately from kilometres. This changes this
                      workout only; choose trail again for another week.
                    </p>
                  )}
                  {movementIssue && (
                    <p className="muted small-text">
                      {movementIssue}. You can still preview skipping this
                      workout.
                    </p>
                  )}
                  {action === "swap" && !swapSessions.length && (
                    <p className="muted small-text">
                      No editable workouts on this day. Choose another saved
                      day.
                    </p>
                  )}
                  <p className="muted small-text">
                    Moves and swaps keep workout distances and targets. Only
                    saved weeks are available. Recorded workouts and races stay
                    fixed.
                  </p>
                  <div className="adjustment-actions">
                    <Button type="submit" disabled={!validWorkout || busy}>
                      {pending === "preview"
                        ? "Preparing preview…"
                        : "Preview change"}
                    </Button>
                    <Button
                      type="button"
                      className="button-secondary"
                      disabled={!selected || !!movementIssue || busy}
                      onClick={() =>
                        void getPreview({
                          mode: "suggest",
                          day,
                          sessionId,
                          reason,
                        })
                      }
                    >
                      {pending === "suggest"
                        ? "Finding a day…"
                        : "Find a suitable day"}
                    </Button>
                  </div>
                  <p className="muted small-text">
                    Suggestions use your saved schedule and availability. No AI
                    fee.
                  </p>
                </fieldset>
              </form>
            ) : (
              <p className="muted small-text adjustment-empty">
                No editable workouts on this day. You can still update
                availability or review recent changes.
              </p>
            ))}
          {tab === "availability" && (
            <form
              className="adjustment-form"
              onSubmit={(event) => {
                event.preventDefault();
                void getPreview({
                  action: "availability",
                  day: availabilityDay,
                  slots: blockedSlots,
                  reason,
                });
              }}
            >
              <fieldset disabled={busy || !futureDays.length}>
                <legend className="sr-only">Availability change</legend>
                <div className="adjustment-fields">
                  <label htmlFor={`${id}-availability-day`}>
                    Day
                    <select
                      id={`${id}-availability-day`}
                      required
                      value={availabilityDay}
                      onChange={(event) => {
                        clearPreview();
                        setAvailabilityDay(event.target.value);
                        setBlockedSlots(
                          catalog.availability.find(
                            (block) => block.day === event.target.value,
                          )?.slots ?? [],
                        );
                      }}
                    >
                      {futureDays.map((d) => (
                        <option key={d.day} value={d.day}>
                          {dateLabel(d.day)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {reasonField}
                </div>
                <fieldset className="adjustment-slot-choices">
                  <legend>When are you unavailable?</legend>
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={blockedSlots.length === slots.length}
                      onChange={(event) => {
                        clearPreview();
                        setBlockedSlots(event.target.checked ? [...slots] : []);
                      }}
                    />
                    Whole day
                  </label>
                  {slots.map((slot) => (
                    <label className="checkbox-line" key={slot}>
                      <input
                        type="checkbox"
                        checked={blockedSlots.includes(slot)}
                        onChange={(event) => {
                          clearPreview();
                          setBlockedSlots(
                            event.target.checked
                              ? [...blockedSlots, slot]
                              : blockedSlots.filter((value) => value !== slot),
                          );
                        }}
                      />
                      {slotLabels[slot]}
                    </label>
                  ))}
                </fieldset>
                <p className="muted small-text">
                  Clear all checkboxes to remove a block. Blocking a time
                  removes uncompleted workouts in that window; clearing a block
                  may restore them. Review the before and after before saving.
                </p>
                <Button type="submit" disabled={busy || !availabilityDay}>
                  {pending === "preview"
                    ? "Preparing preview…"
                    : "Preview availability"}
                </Button>
              </fieldset>
              {!futureDays.length && (
                <p className="muted small-text">
                  No upcoming saved days are available to edit.
                </p>
              )}
              {!!catalog.availability.length && (
                <div className="adjustment-blocks">
                  <h4>Existing blocks</h4>
                  {catalog.availability.map((block) => (
                    <div className="adjustment-history-item" key={block.day}>
                      <p className="small-text">
                        <strong>{dateLabel(block.day)}</strong> ·{" "}
                        {block.slots.length === 3
                          ? "Whole day"
                          : block.slots
                              .map((slot) => slotLabels[slot])
                              .join(", ")}{" "}
                        · {reasons[block.reason]}
                      </p>
                      {block.day >= catalog.today && (
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={busy}
                          onClick={() => {
                            setAvailabilityDay(block.day);
                            setBlockedSlots([]);
                            void getPreview({
                              action: "availability",
                              day: block.day,
                              slots: [],
                              reason,
                            });
                          }}
                        >
                          Preview clearing block
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </form>
          )}
          {tab === "history" && (
            <ScheduleChangeHistory
              history={catalog.history}
              pending={busy}
              onUndo={(id) => void getPreview({ action: "undo", id })}
            />
          )}
          {pending && (
            <p className="muted small-text" role="status">
              {pending === "apply"
                ? "Applying your reviewed change…"
                : pending === "suggest"
                  ? "Checking suitable saved days…"
                  : "Preparing your preview…"}
            </p>
          )}
          {preview && (
            <ScheduleChangePreview
              preview={preview}
              easyPaces={catalog.easyPaces}
              applying={pending === "apply"}
              onApply={() => void apply()}
              onCancel={clearPreview}
            />
          )}
        </>
      )}
    </section>
  );
}
