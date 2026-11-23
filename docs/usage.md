# Using Garmin AI Coach

[Project overview](../README.md) · [Training rules](training-policy.md)

## Find the right screen

| Screen       | Use it for                                                                             |
| ------------ | -------------------------------------------------------------------------------------- |
| **Today**    | Current sessions, recent recovery information and optional check-ins.                  |
| **Plan**     | Weekly approval, day-by-day workout steps, attendance and schedule adjustments.        |
| **Events**   | Road/trail races, race-pacing evidence and training breaks.                            |
| **Coach**    | AI explanations and proposed daily changes.                                            |
| **Progress** | Recorded activity, training trends, workout reviews and mileage attribution.           |
| **Settings** | Garmin connection, FTP, running targets, fitness evidence and long-term volume review. |

## Set up

1. Add the Garmin personal API key on the server and restart the app and worker.
2. Open **Settings** and sync Garmin. The first sync imports the previous 90 days.
3. Review your FTP and running targets. Defaults are starting settings, not measurements of your fitness.
4. In **Events**, add known races or breaks that should affect planning.

An OpenAI key enables AI reviews but is not required for local planning or automatic recovery assessment. Keys and automation secrets are never entered as an app passphrase.

## Plan a week

Open **Plan** after sync. Review the completed week's running, the proposed stage and the full calendar. Choose Hyrox attendance and cycling days, inspect the steps, then select **Accept this week**.

Only acceptance activates a new week. Later weeks are conditional forecasts. **Previous**, **This week**, **Next** and **Jump to week** browse without saving or making an AI request.

The initial mileage build continues into consolidation and recurring training blocks. **Settings → Long-term training** provides a separate review for an optional higher ceiling. A forecast or ceiling change is not permission to skip the weekly review.

## Follow the workouts

Open **Today**, or choose a day in **Plan**. Each running workout shows its total distance, warm-up, main work, recovery steps where needed, and cool-down. Use **Copy Garmin steps** to recreate it in Garmin Connect.

Cycling shows duration, watts and percentage of the current FTP. Use **Copy Zwift steps** when building the ride in Zwift. Changing FTP in Settings updates the cycling power calculation; it does not recalibrate running targets.

If you already created a workout in Garmin Connect, update it there after changing the app's plan. The app does not upload or reschedule Garmin workouts automatically.

## Change a workout

Open **Change workout** in Today or on a saved day in Plan. Move, swap or skip a session, choose a reason, and inspect **Preview change** before applying it.

**Find a suitable day** ranks valid options locally. Moves retain their workout steps and distance. Changes must fit the reviewed week, session limits, availability and recovery rules.

Under **Availability**, block a training window or whole day. The app removes uncompleted sessions from blocked windows without redistributing missed distance. Clearing a block can restore an original session, so review the resulting preview.

**Recent changes** supports undo when later edits, recordings or changed planning context do not conflict. A cross-week move requires both weeks to be saved. Move it back or undo it before replacing either reviewed week.

## Choose Hyrox and cycling

Choose **Going**, **Skipping** or **Undecided** independently for Monday, Wednesday and Friday. An undecided class reserves the later slot; it is not confirmed attendance.

Cycling days and replacement cycling for skipped classes are separate choices. Cycling supports running and can replace Hyrox, but never replaces a run. A selected recovery ride is optional: skip or stop if recovery requires it.

## Add races and breaks

In **Events**, enter the date, course distance, road/trail terrain, expected duration, ascent where known, and goal or training priority. Events can be planned up to two years ahead, including on Sunday. **View race week** opens their calendar context.

A registered event stays visible even when a recovery conflict prevents prescribing it. Resolve participation in Events rather than treating registration as another workout to complete.

Road-race pace guidance uses a recent Garmin prediction or a confirmed road performance entered under **Road race pacing**. An event's target finish time is a goal, not performance evidence. Trail events use effort instead of extrapolated road pace.

For travel, illness, injury or planned rest, add a dated or indefinite break. It suppresses uncompleted training across sports. Return from a break has an explicit review and reduced baseline; it does not automatically restore the old load.

## Use a trail long run

Select the long-run day, then **Change workout → Road / trail long run**. Enter estimated outing time, including hiking, and optional ascent. Preview and apply.

Distance stays the same. Trail steps use numeric effort targets: normally RPE 3–4/10 for the main work and 2–3/10 for warm-up/cool-down. In Garmin Connect use **No Target** and put those RPE instructions in the step notes. Hike steep climbs and treat HR as feedback rather than a narrow road-running alert.

The selection applies to that workout, including a moved long run. Switching back to Road restores its original prescription when available. Additional trail duration and climbing may justify reducing supporting training.

## Let recovery reassess automatically

After a race, Plan shows **Automatic recovery review** and expandable evidence. After initial rest, the app can restore the existing base range for upcoming, unmodified runs when completed recovery runs and current Garmin overnight data support it.

The assessment is local and makes no AI request. It needs two qualifying recovery-run days and overnight evidence after the latest run. Missing or concerning data keeps recovery effort; new concerns can reverse an earlier automatic decision. Hyrox and quality restrictions stay in place through the recovery window.

Some selected cycling can remain as optional recovery rides, with a maximum of two non-consecutive 60-minute rides in a recovery week. It does not return during initial rest or override other recovery restrictions.

Daily check-ins are optional. Report pain or unusual fatigue when needed: Garmin cannot determine their absence. An optional manual return-to-base review remains in Events when automatic evidence is incomplete. See [the recovery rules](training-policy.md#post-race-recovery) for the assessment criteria.

## Review completed training

After sync, open **Progress → Workout reviews**. Check the prescribed workout against the recording, and confirm or correct an ambiguous match. The app uses the version known before the activity began; it does not assume a later-edited workout was what you ran.

**Easier**, **About right** and **Harder** feedback is optional. Numeric effort ratings and recovery reports are separate. Distance matching does not prove interval execution or time spent within an HR target.

Under **Progress → Race mileage**, associate recordings with an event and identify any race warm-up/cool-down distance. Those extras remain recorded physical load but are excluded from the milestone target. Hyrox running never counts as dedicated running mileage.

## Use the AI coach

The Coach screen provides daily and weekly explanations. Proposed schedule changes require approval and must pass local rules. Automatic post-race base reassessment is a separate local feature, so it does not need a daily AI approval.

Automatic and manual AI reviews share request limits and cached results. A failed review leaves the local planner available. Browsing, copying steps, saving feedback and calculating recovery assessments do not make an AI request.
