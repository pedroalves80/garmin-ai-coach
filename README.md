# Garmin AI Coach

Mobile-first personal training coach for running, Hyrox and cycling. The app is designed for private Raspberry Pi deployment and uses Atomic Design for the UI.

## Current status

Implemented:

- Next.js App Router dashboard shell
- Mobile-first responsive layout
- Atomic Design components under `src/components`
- Typed workout and coach contracts
- Server-only Garmin and OpenAI boundaries
- SQLite persistence with Drizzle-compatible schema
- Garmin token exchange, sync status and protected sync route
- Docker and Docker Compose configuration
- Training trends, optional check-ins, versioned planned-versus-completed workout reviews and progression reviews
- Persistent fitness evidence with source, measurement date (or unknown), revision history and archiving
- Automatically prepared weekly plans with stage continuity, one weekly approval, and optional recovery reporting
- Daily automatic and on-demand AI reviews, cached responses and approved workout reductions
- Automatic startup and three-hour Garmin syncing with persistent retries and worker health

The dashboard reads stored Garmin data and includes an ongoing running planner with Garmin-ready steps: an initial 30-stage build, six consolidation weeks, then repeating performance/cutback blocks. Future stages are previews; only explicitly saved weeks enter adherence comparisons. The Coach tab explains the training and proposes daily changes for explicit approval.

## Screens and navigation

The light interface uses dark text and green accents. Desktop navigation is a sidebar; phones use a persistent bottom bar with the current screen highlighted.

- **Today** (`/`): today's recorded/scheduled running, weekly totals, a recovery snapshot and an expandable check-in form.
- **Plan** (`/plan`): a seven-day selector and one workout's Garmin-ready distance steps at a time. Every generated run totals at least 5 km including warm-up and cool-down. Use the visible **Previous / This week / Next** controls or **Jump to week** to browse the calendar. Saved weeks retain their exact reviewed steps; unsaved future weeks show mileage milestones and explicitly conditional tempo forecasts, rechecked against completed training at weekly approval. Forecasts never count as completed training or activate directly. Browsing never saves a week or calls AI. Manual volume, stage and tempo edits remain under **Adjust week & pace settings**; choosing a stage no longer changes the viewed date. Saving still requires explicit review and the existing progression checks.
- **Events** (`/events`): races and training breaks, with multiweek impact previews. **View race week** opens the exact event day in Plan.
- **Coach** (`/coach`): on-demand daily/weekly reviews and reviewed changes. Privacy, usage limits and review metadata are available through expandable details.
- **Progress** (`/progress`): switch between training trends and recent activities. Comparison methods and saved-versus-recorded details expand on request.
- **Settings** (`/settings`): Garmin connection, automatic sync status and data/privacy information.

Old section bookmarks such as `/#connection` redirect to the corresponding screen. A shared status observer refreshes the visible screen when Garmin imports change, without making AI requests. Workout targets, copy actions, check-in saves and approval rules remain available across the new screens.

## Your weekly routine

After Garmin sync, open **Plan**. **Your weekly coach** shows the completed stage, recorded versus planned kilometres and the current Monday’s proposed stage and full calendar. Review attendance and steps, then tap **Accept this week** once. Preparation never activates or replaces a saved week; individual changes still use **Change workout**. If data/settings change before approval, refresh and review the updated draft. An accepted week preserves its reviewed steps and subsequent daily changes.

Daily recovery check-ins and effort ratings are optional. Use **Recovery update** once a week or when pain, fatigue or soreness changes. Garmin sleep and resting-HR coverage can support a small volume proposal; unknown recovery permits a steady week. Persistent breaks and return-from-illness/injury reviews retain their explicit symptom checks. Missing ratings are not zero measured load. Average activity pace/HR cannot certify interval execution or justify automatic threshold/pace changes; targets stay at their reviewed settings.

A background AI review selects only among locally bounded recommended, consolidation and recovery options. It defaults to the local recommendation; choosing a lower option requires a machine-checked reason present in the current evidence. Routine supporting work is compared with its recent baseline, rather than treated as an automatic mileage veto. Unsupported cached AI choices are corrected locally without deleting their audit record or making another paid request. It uses recent completed weeks and sanitized session summaries, and can reduce supporting work. With automatic coaching enabled and a configured key, it attempts at most one weekly request, shares the existing 6/day and 60/month request limits, uses at most 900 output tokens and makes no automatic retry. Page reads and refreshes never call OpenAI. New evidence refreshes the local draft without another paid request. Failure or an absent key leaves the local proposal available for approval. Nothing is pushed to Garmin automatically.

## Ongoing training and optional ceilings

The calendar has no fixed end date. The initial 25,27,29,23…80 km sequence stays unchanged. Weeks 31–36 consolidate with 76,78,64,78,80,64 km forecasts; subsequent four-week performance blocks repeat 76,78,80,64 km. Cutbacks remain lighter and remove ordinary tempo/strides. Race, break, recovery, workload, single-run and weekday-time rules apply before approval. Week numbers, date navigation and weekly approvals continue across years; the preview window rolls two years ahead from the current Lisbon date. Open/resumed pages refresh when the server’s Lisbon date changes, independently of a Garmin sync; the default current-week editor follows the new day while explicit historical browsing stays selected. Saved history and the original calendar anchor are retained without the old three-year plan/preferences cutoff or 52-override read cutoff. Recent analysis windows and AI summaries remain bounded.

Under **Settings → Long-term training**, review an optional 85 or 90 km ceiling. Raising it requires completion of the initial build and consolidation, at least four of the last six approved/recorded weeks near the existing ceiling, a completed latest reviewed week, a week at that ceiling, fresh Garmin data, available supportive recovery and no relevant effort/race/break concerns. These are app planning heuristics, not clearance or a guarantee of safe mileage. Ratings and daily check-ins remain optional. The review is calculated locally and uses a stale-data token; it does not spend an AI request. A lower ceiling can always be reviewed.

Only explicit **Apply reviewed ceiling** saves the long-term policy. Existing approved weeks retain their exact prescriptions. New weeks still need the usual single weekly acceptance. A reviewed 90 km ceiling forecasts 82,84,86,69 then 86,88,90,72 km and repeats within that cap; 85 km forecasts stay within 85. Goals are conditional, never deadlines, and a gap or adverse recovery can still produce a much lower baseline. No pace, HR, FTP, stride target or Sunday-rest rule is changed by reviewing a ceiling.

The same-origin GET/POST `/api/training/planning-policy` routes provide the local preview and guarded policy save. Policy JSON is stored separately from athlete calibration, so long-term volume choices cannot certify physiological targets. Database backups include the policy and retained history.

## Changing a workout

Open **Change workout** in Today or on a saved day in Plan. Choose **Move**, **Swap** or **Skip**, a reason, and (for moves) a date and morning/lunch/later window. **Preview change** shows the affected sessions, weekly kilometres and recovery conflicts. Only **Apply change** saves anything. Workout steps and numeric pace/HR/power targets are preserved; Garmin Connect scheduling must still be updated manually.

**Find a suitable day** ranks valid dates locally with no AI request. The coach also sees availability and movement recovery warnings. It never applies a proposed adjustment without approval.

Under **Availability**, block a window or whole day. Uncompleted sessions in blocked windows are excluded without adding their distance elsewhere. Clearing a block may restore those original sessions; review the preview. Recorded activities remain in history. Past unrecorded prescriptions are labelled **Unconfirmed**, rather than assumed missed.

**Recent changes** provides guarded undo. Undo cannot overwrite a newer edit, a recorded workout, a changed reviewed week, or changed recovery/commitment context. All affected rows save atomically, and a new activity or edit invalidates an open preview. Cross-week changes require saved weeks and respect each reviewed running budget and key-session allowance. Move a cross-week session back or undo it before replacing either reviewed week.

## Learning from completed runs

Open **Progress → Workout reviews** after Garmin sync. Automatic matching uses the saved prescription version known before the activity began, its date, and a unique recording. Moves, approved changes and removed runs retain immutable versions. Older weeks imported at rollout are labelled legacy baselines: the app cannot reconstruct an exact past prescription it never recorded. Confirm or correct ambiguous matches; manual links do not move training or certify an old version. A session cannot be completed by two recordings, even across prescription versions. Hyrox and race-only extras cannot complete a run.

The review separates planned, counted and total distance. Distance within 90–110% of plan is a distance comparison, not proof of full workout execution. Garmin's documented detail and attached-workout endpoints are checked for at most eight recent runs per sync; unchanged data is cached. Individual warm-up/main/cool-down averages are compared only for an unambiguous single split with a matching distance. Grouped intervals, missing splits, effort execution and time in target remain unknown. Strides are not judged by reaching high HR. No FIT parsing or invented lap detail is used.

**Easier / About right / Harder** is optional and can be cleared. It is separate from optional numeric RPE and symptom reports. Reviews are calculated locally; importing an activity or saving feedback does not make an AI request. Compact review counts and fitness references join the existing bounded daily/weekly coach context. Existing request budgets and approval requirements still apply; accepted weeks are not overwritten.

Under **Settings → Fitness evidence**, record threshold estimates or comfortable-conversation observations. Source, observed date and reported date stay distinct. Leave the measurement date empty when unknown. Editing creates a revision; archive/restore retains history. Wearable estimates and self-reports do not automatically validate targets, change strides, or update cycling FTP. Device names and sensor labels stay out of the AI summary, as do raw Garmin details and GPS.

Garmin sync uses the official [Personal API Swagger](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/) (v1.0.0, checked 2026-10-29):

- `GET /activitylist-service/activities/search/activities` with `start`, `limit`, `startDate`, `endDate`; distances are meters and durations are seconds.
- `GET /usersummary-service/v2/dailysummaries` returns `{ data: [...] }`, including nested `heartRate.restingValue` and `bodyBattery.latestValue`.
- `GET /sleep-service/sleep/dailySleepSummariesByDate` returns daily sleep summaries; each request covers at most 31 days.
- `GET /activity-service/activity/{activityId}` provides sanitized split summaries; `noOfSplits` can indicate aggregated data.
- `GET /activity-service/activity/{activityId}/workouts` supplies attached workout metadata, not execution proof (detail endpoints checked against Personal Swagger on 2026-11-16).

Token exchange uses the official Personal API token endpoint. Access tokens are held in memory for up to 24 hours (with an expiry margin); a 401 triggers one renewal. Network errors, HTTP 429 and 5xx responses retry at most twice with timeouts and bounded delays. Credentials and raw response bodies are never logged.

## Local development

```bash
cp .env.example .env
npm run db:migrate
npm run dev
```

Open http://localhost:3000.

Set `GARMIN_PERSONAL_API_KEY` and, optionally, `OPENAI_API_KEY` in `.env`, and restart after changing environment variables. No login, session key or passphrase is required to use this trusted-local app. Without an OpenAI key, Garmin syncing and the planner still work. Existing `APP_SESSION_SECRET` values are unused and may remain in older `.env` files.

In the Garmin panel, press **Sync Garmin**. The Garmin key stays on the server. The first sync imports the last 90 days. Later syncs replay from seven days before the last successful checkpoint to capture late uploads and corrections. Use “Recheck the last 90 days” for older edits within that period. Deletions in Garmin are not mirrored yet.

Each successful sync updates normalized fields and retained JSON in a single database transaction. A failed sync preserves existing records and the last successful checkpoint. SQLite leases prevent concurrent imports across app processes. Missing sleep/HR measurements remain null, rather than fabricated zero values.

## Automatic Garmin syncing

Production `npm start` launches both the Next.js server and the Garmin worker and stops both on Ctrl+C/SIGTERM. Build first with `npm run build`; it also compiles the independent worker using TypeScript, without adding a runtime transpiler. During development, run `npm run build:worker && npm run worker` in a second terminal alongside `npm run dev`.

The worker attempts a sync on startup, then three hours after each successful scheduled run. A persisted five-minute startup cooldown avoids repeated requests during rapid restarts. Network failures, HTTP 429 and 5xx responses schedule retries after 5 and 15 minutes; further failures return to a three-hour wait. Credential and malformed-data failures wait three hours immediately. Existing per-request retries still apply. Set `GARMIN_AUTO_SYNC=false` in `.env` and restart to disable scheduled calls; manual sync continues to work. The same worker can also prepare the optional daily AI review under the separate limits described below.

Schedules and retry counts live in SQLite. A 90-second leadership lease, renewed every 20 seconds, selects one worker across processes; the existing Garmin sync lease also prevents overlap with manual sync. Work is checked every 30 seconds, so scheduled times can vary by that amount while the worker is healthy. A successful manual sync cancels outstanding scheduled retries and starts a fresh three-hour interval. Missed intervals are not replayed individually after downtime.

Sync jobs have a five-minute deadline, including token exchange and pagination. Shutdown cancels in-flight HTTP calls and preserves the last successful checkpoint. The app polls local sync status every 30 seconds while visible and refreshes imported data when the successful-sync timestamp changes. Settings shows worker availability, retry errors and the next attempt in Lisbon time. The status endpoint reports worker health separately from Garmin connectivity; a healthy worker can be waiting for credentials or a network retry.

Docker Compose runs the web app and `garmin-worker` as separate services using the same image and persistent SQLite volume. The worker has no published port; its healthcheck reads the stored leadership lease, and `restart: unless-stopped` restarts an exited process. Docker marks a failed healthcheck unhealthy; health status alone does not restart a process. Use `docker compose logs -f garmin-worker` and `docker compose ps` to inspect it. No new passphrase or scheduler API key is needed.

Dashboard weeks start Monday in Europe/Lisbon. Hyrox is identified by its type or an explicit HYROX activity label; generic strength sessions are not assumed to be Hyrox. Meditation, breathing and yoga are separate wellness time. Per-sport minutes describe volume, not physiological load or equivalent running distance.

## Training metrics and planner

- Four completed weeks plus the current partial week show running distance and time. Week-over-week percentage change compares completed weeks only.
- Similar-run observations compare the latest 28 days with the preceding 28, using at least three independent matched pairs. Matching requires road running, average HR within your configured base range (135–148 bpm by default) with at most 3 bpm difference, distance within 10%, start locations within 250 m, ascent density within 5 m/km, and temperature within 5°C where available. Missing ascent/location excludes a run. Matching start points does not establish identical routes; wind, effort and stops are not controlled. These are observations, not proof of a lower HR or a standardized fitness test.
- Log fatigue and muscle soreness on a 1–5 scale and pain on a 0–10 scale. Check-ins upsert by date, are stored locally, and accept dates within the last 14 days. Coach requests include recent scores; notes stay local. No scores are filled in automatically.
- A plan starts on Monday and stores a complete snapshot of its reviewed steps. The prepared draft defaults to the current Lisbon Monday and remembers the last completed saved stage. At least 90% recorded distance supports advancing one stage; incomplete weeks repeat the stage, and gaps lower the baseline rather than restoring a past peak. Recorded sessions remain visible and past prescriptions are never assumed completed. The first 30 stages toward 80 km are milestone ceilings. After the initial build, week numbering continues indefinitely through consolidation and repeating blocks; missing training lowers the proposal rather than restoring an old peak. Reviewed volume can be set below a milestone; at least 20 km is supported in this starting template.
- Save starting stage 1 first. Later approvals move no more than one stage at a time. An increase must satisfy the volume review and cannot exceed its suggested kilometers. Holding/reducing is supported by repeating the stage or using a lower reviewed volume. Saving a plan does not publish anything to Garmin.
- New workouts use distance for every step, including warm-ups, cool-downs and nested repeats. Every run is at least 5 km in total. The weekly split is redistributed within the reviewed total, rather than increasing weekly volume to meet this minimum. The 20 km minimum supports four 5 km runs. Distances use 10 m increments, so the steps displayed and copied into Garmin add up exactly; reviewed volume accepts increments of 0.01 km.
- Tuesday has six 0.08 km strides with 0.25 km recovery steps. New quality drafts develop from two 1 km tempo repetitions through controlled increases in working distance, with 0.30 km recoveries. Older approved two-by-1.30 km prescriptions remain readable. Pace/HR targets still control intensity; changing a pace does not change the planned kilometers. Cutback weeks replace quality work with base running.
- Previously saved snapshots keep their reviewed steps until explicitly resaved. If an older saved week differs from the new generator, Plan shows an updated draft for review. Legacy timed steps remain readable and use estimated distance for historical comparisons. The current distance-only planner shows kilometers without a scheduled-duration target.
- Recorded distance is matched by local day. “Distance met” means at least 90% of the estimated distance, not that target pace, HR or session intent was achieved. Several runs on one day are combined; future days are not marked missed.

Mutation routes `POST /api/training/check-in`, `POST /api/training/plan`, `POST /api/training/week` and `POST /api/garmin/sync` accept normal same-origin app requests. The UI adds a non-secret `x-coach-request: local` header; the server checks the request origin and Fetch Metadata. Cross-origin forms and foreign websites cannot use these browser actions. Requests addressed to unrecognized public hostnames are rejected for both reads and writes to help prevent DNS rebinding. Common loopback, private LAN/overlay IPs, single-label hostnames, `.local`, `.localhost` and `.home.arpa` names work by default. Use `APP_ALLOWED_ORIGINS` for another custom private name.

Progression rules are transparent app heuristics, not validated injury predictions: recent pain or high fatigue/soreness suggests reduction; missing/stale sync, incomplete weeks or insufficient recovery evidence suggest holding. An increase requires a finished recent plan, at least 90% recorded distance, and either recent low-fatigue reporting or sufficient Garmin sleep/resting-HR coverage without configured caution flags. Missing daily reports or RPE ratings never prevent saving an ordinary steady week; absent reports remain unknown, not a pain-free assertion. A competing-sport time rise over 25% also triggers a review. New peak-volume suggestions are capped at the smaller of 2 km or 5%; this is a conservative implementation choice, not a universal safe percentage. Scheduled cutbacks remain reductions. A completed planned cutback can return toward a recent verified build week, with rated effort, adherence and recovery evidence. Missed weeks and unplanned recovery reductions do not authorize this restoration. The timeline can extend beyond 30 weeks.

The single-session review flag compares the longest planned run with the longest recorded in 30 days; a >10% difference asks for review. It is informed by this [2025 cohort study](https://pubmed.ncbi.nlm.nih.gov/40623829/), not a guarantee of safety. The broader evidence does not establish a universal weekly progression rule: see the [systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC9528699/).

This is a single-user app with no sign-in. Access control is your network boundary: anyone who can reach the app through an accepted hostname can view its data and use it. A Raspberry Pi alone does not restrict network access; keep the service on your trusted LAN/VPN and do not port-forward it publicly. Host/origin protections do not authenticate users or replace a firewall.

## Athlete planning and review

The focus is durable aerobic running, sustainable mileage and faster pace at comparable HR. Race calendar adjustments reduce nearby training and add recovery; the app does not validate race readiness or prescribe a fixed date to reach 80 km. Existing approved snapshots remain unchanged until a reviewed replacement is saved.

- **Settings → Running targets & fitness review:** edit numeric pace and HR ranges; record field/lab/coach review evidence and date. Evidence notes stay local. Provisional or older-than-six-week reviews hold faster pace/higher HR targets; small tempo-distance increases may use established prescriptions and recorded recovery evidence without recalibrating targets. The app records the review; it cannot independently validate a physiological threshold.
- **Progress → Rate completed training:** rate overall session effort 1–10, ideally after settling about 30 minutes post-session. Load is recorded minutes × session RPE, in arbitrary units. Running, cycling, Hyrox and other sports contribute; wellness remains separate. Missing effort or duration is unknown. Two completed rated weeks can establish measured-effort comparison context. Unknown ratings stay unknown; they do not independently block a supported running proposal.
- **Tempo evidence:** ratings remain optional. At least two recent quality-day recordings at the current prescribed tempo dose/pace, matched to versions known before activity start, can support one small tempo-distance proposal when running adherence, fresh Garmin data and recovery evidence support it. Legacy date/average matches alone do not count. A full-session distance match does not prove interval execution; the proposal labels that uncertainty. Explicit athlete confirmations and isolated Garmin aggregate tempo evidence are counted separately. Harder feedback, adverse isolated tempo averages, recovery flags and measured load growth hold additional tempo distance. Missing daily check-ins do not block progression when Garmin recovery coverage is supportive.

- **Plan → Weekly effort review:** estimated prescriptions and measured completed load are labeled separately. Estimates use RPE 2 for base/recovery running, 3 for strides/long runs, 6 for tempo, 2–3 for cycling and 7 for Hyrox; undecided classes are included conservatively. The app flags demanding secondary sessions around key runs, consecutive key sessions and very long combined training days.
- **Separate pace from tempo distance:** a new proposal can increase tempo by one existing level (400–600 m extra work), including during a mileage rise of at most 10% at unchanged pace/HR settings. Added tempo replaces base distance within the weekly total. Newly generated tempo doses are bounded by 10% of weekly distance with a 2 km baseline, and must fit the session with bookends and recoveries; these are planning heuristics, not validated safety guarantees. Cutbacks, recovery, post-cutback return weeks and gaps hold tempo development. Strides remain six 80 m accelerations at the existing targets. Faster pace/HR targets still need current review at steady mileage. Saved weeks remain exact and cannot repeatedly advance through re-saving. Future forecasts assume two suitable quality opportunities per level, omit cutback/return opportunities and stay conditional until weekly approval.
- **Recovery wins:** skipping an uncompleted later session preserves the run, including moved runs. A prescribed ride lasts at least an hour, but no ride is mandatory. Recent hard sessions and moderate fatigue remove secondary load and can replace quality with the configured recovery HR range; higher fatigue or pain further restricts training. Sunday rests except for an explicitly scheduled race.
- **Fresh advice:** Coach and Today flag reviews when the training fingerprint changes. Approvals store the resulting fingerprint so the approval itself does not make a review stale. New recovery/effort data requires a fresh recommendation before relying on old advice. Background AI remains at most one attempt per day; status polling never generates a review.

The 15% combined-effort review flag, three-demanding-day flag, six-week target-review interval, RPE assumptions and progression steps are transparent application heuristics, not universal safe limits or validated injury predictions. Session RPE follows the approach described by [Foster et al.](https://pubmed.ncbi.nlm.nih.gov/11708692/); combining workload and individual responses follows the [IOC load-monitoring consensus](https://doi.org/10.1136/bjsports-2016-096581). Mechanical running stress is still assessed separately through distance and longest-run checks; equal AU does not make different sports interchangeable.

Periodic comparable-route observations use your configured base HR range. Repeat familiar routes in similar conditions and judge trends across multiple runs. Temperature is constrained when present; wind, exact route, stops and effort are not fully controlled, so the app labels these as observations rather than proof of a fitness change.

## AI coach

Open **Coach** and choose **What should I do today?** or **Review my week**. Reading pages/status never calls OpenAI directly. When automatic coaching is enabled in Settings (default), the background worker waits for a saved current week, Garmin data no older than two days, then prepares at most one recommendation per Lisbon date. Sunday normally skips automatic review; an explicitly scheduled Sunday race can receive one. Active breaks and pending return reviews suppress automatic reviews. `GET /api/coach` reads local status/history; same-origin `POST /api/coach` generates reviews or approves their proposed workout changes.

The adapter uses the [OpenAI Responses API with structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), server-side validation, a 30-second timeout, low reasoning effort, at most 1,600 output tokens and no automatic retries or model fallback. `OPENAI_MODEL` defaults to the inexpensive [gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna). Changing it requires a model supporting Responses, structured outputs and low reasoning effort. Actual charges depend on the configured model and OpenAI pricing.

SQLite records request attempts before contacting OpenAI. Limits are six fresh attempts per Lisbon calendar day and 60 per calendar month, shared across browser sessions and app restarts. Failed attempts also count because their billing status can be uncertain. These are request limits, not a dollar budget. Context is bounded to 24 KB and output is capped; unchanged reviews are cached by model, prompt version and training fingerprint. A persistent lease rejects overlapping requests. Automatic reviews share these same limits. A persistent daily claim prevents retries after failures or restarts; use a manual review to retry or update a recommendation after the data changes.

Only an explicit allowlist of training/health summaries is sent: five weeks of sport totals, seven days of session summaries, sleep/resting-HR/Body-Battery measurements, check-in scores, the saved plan’s stage/volume, the full weekly session calendar, Hyrox attendance, FTP and step targets and locally calculated progression/comparison results. Garmin raw JSON, locations, activity names, check-in notes, credentials and personal identifiers are excluded. Dates are included for scheduling. Requests set `store: false`; this does not eliminate OpenAI's default abuse-monitoring retention. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

The model chooses from locally allowed actions: follow, shorten, replace quality with a recovery run, rest from remaining training, remove an uncompleted secondary session, replace Hyrox with recovery cycling, or move today’s run to a legal later date in the same week. A move preserves distance and cannot use Sunday, an occupied running day, completed training, a third session or a weekday run exceeding the lunch window. The model cannot invent arbitrary steps, add volume/speed or upload to Garmin. Changes are built and checked locally. Recovery run changes use your configured recovery HR range (125–140 bpm by default), at most the original distance, and a 5 km minimum. At that minimum the coach can rest rather than shorten. Recent reported pain requires rest; high fatigue restricts running to reduction or rest. These are app heuristics, not validated injury predictions.

**Approve schedule change** shows the exact affected dates and all remaining sessions, then saves only after rechecking the training fingerprint and date. A new sync, changed settings/plan/check-in or recorded activity invalidates an unapproved proposal. Approval never happens automatically. Saving a newly reviewed running week clears that week’s daily edits. Attendance edits preserve moved/reduced runs. The original weekly distance remains the reviewed baseline; adherence uses the effective running dates. Copy the local prescriptions into Garmin Connect or Zwift.

## Full weekly calendar

Plan includes running first, plus one later Hyrox or cycling session, never more than two daily. Choose **going**, **skipping** or **undecided** independently for Monday/Wednesday/Friday Hyrox. Undecided reserves the later slot and is labeled tentative. Default cycling is Tuesday/Thursday/Saturday; skipped classes may become recovery cycling. No cycling replaces running. Sunday is unscheduled rest except for an explicitly entered race. Garmin history is retained even if extra workouts were actually recorded; the UI blocks a third planned workout rather than hiding history.

Weekday lunch is at most 120 minutes; later weekday sessions and Saturday have no availability cap. Every planned cycling workout totals at least **60 minutes**, including warm-up and cool-down, for both recovery and endurance. Default rides are 60 minutes weekdays / 90 minutes Saturday, editable above that minimum. Older shorter preferences and saved calendar rides are upgraded when read; recorded activity durations remain unchanged. Running frequency grows with reviewed volume (four days below 40 km, five from 40 km, six from 60 km); the minimum remains 5 km per run. Upcoming runs can also move to a free Monday–Saturday day in the calendar.

FTP defaults to **176 W** and is editable in Settings. Recovery main sets use 45–55% FTP (**80–96 W**); endurance uses a conservative 56–70% (**99–123 W**), plus separate warm-up and cool-down steps. These are narrower supporting targets within the [Coggan/TrainingPeaks power levels](https://www.trainingpeaks.com/blog/power-training-levels/), not a threshold test or a prescription to raise cycling load alongside running. Future saved cycling adjustments also use the current FTP. Cycling targets are watts/%FTP, running targets numeric pace or HR.

Provider failures, refusals, incomplete output, schema errors and disallowed actions leave workouts unchanged. The UI shows a retryable error without exposing provider responses or secrets.

## Races and training breaks

Open **Events → Races & training breaks**. The form previews the affected week before **Save race & adapt calendar** or **Save break & pause training** applies the commitment. Registered events work even without a saved training week; ordinary workouts still need a reviewed week. Event entry does not register with an organizer or send workouts to Garmin. The race form previews before/after mileage and removed supporting sessions for every affected current/future preparation, race and recovery week. Saving a race or break stays on Events; **View race week** explicitly opens its day in Plan. A race notice separates the saved baseline from effective calendar mileage and gives the event, priority and preparation/recovery dates. Goal trail events can affect the preceding week through the existing 14-day preparation heuristic; the baseline snapshot and recorded workouts are retained.

- Schedule races up to **730 days ahead**, including Sundays or weekdays. Set course distance (1–100 km), road/trail, optional ascent and start time, expected course minutes and goal/training priority. Edit or cancel upcoming events; mark past events completed explicitly. Distance-matched Garmin records do not independently prove event participation.
- A race replaces that day's ordinary run and supporting session, plus the week's normal tempo/strides and long run. Ordinary runs are removed when necessary to keep the event inside the baseline distance budget. A race longer than that budget is flagged; its entry never authorizes mileage growth. Its fixed distance cannot be shortened or moved by the AI. Race days permit follow/rest only; recent pain, high fatigue, stale sync or insufficient recovery evidence restrict the coach to rest.
- Race prescriptions show **1 km warm-up** at recovery HR, the exact course distance, then **0.5 km cool-down** at recovery HR. The course step uses **Garmin No Target** with numeric RPE instructions (goal 7–9; training 6–7). Terrain and conditions determine actual effort; no invented flat-road pace is assigned to a trail. A short race is an explicit exception to the ordinary 5 km training-run minimum. Course and total distance are labeled separately.
- App heuristics: training races have a two-day preparation window, goal road races seven days, demanding goal races fourteen. Race week removes normal quality/long running; goal races leave the preceding day free. Secondary sessions are removed near the event. Recovery windows are 3 days for short road events, 7 for trails/half marathons or substantial ascent, 14 for marathon-distance or longer; the first 1/2/3 days respectively have no planned workouts. Remaining prescribed recovery runs are 5 km on existing days, spaced apart. Current-day recovery requires a fresh sync and a pain-free, low-fatigue check-in. Overlapping return/recovery windows suppress another event and flag the conflict.
- These windows are planning defaults, not evidence of readiness, a race-specific build or medical clearance. Endurance taper evidence supports reducing volume, but not these exact rules for every athlete ([2023 meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC10171681/)); downhill recovery can differ from flat running ([primary study](https://link.springer.com/article/10.1007/s00421-023-05412-z)). Technical trail preparation and prolonged illness/injury need individual review.
- A dated or indefinite **travel / illness / injury / rest** break removes every uncompleted session. Recorded history stays visible. Breaks override races, without deleting the event. Ended breaks remain paused until **Review return · start gently**: this requires today's pain-free, low-fatigue check-in, no recent reported pain and Garmin synced within two days.
- The reduced return phase prescribes only existing running days, up to 5 km at recovery HR, spaced apart, and no secondary training. It stays reduced rather than automatically restoring an old peak. After at least seven days and recorded return running, **Review & save 20 km recovery baseline** explicitly replaces the current week with the minimum recovery template (no tempo/strides). Previously saved future weeks become pending review; they cannot silently reintroduce the old load. Supporting training stays removed for seven days after this review. This is a starting template for someone able to complete it, not a rehabilitation prescription; stay paused if even 5 km is unsuitable.
- Race/break windows hold volume and quality progression. Affected weeks do not count as positive quality evidence. Future calendar entries never count as completed training. Names stay local; AI receives bounded event summaries (date, course, terrain, ascent, duration and priority) plus break dates/reason. Calendar edits invalidate old coach approvals and cached context. Ordinary run moves still cannot use Sunday. Missed workouts are never accumulated.

## Raspberry Pi deployment

The live homelab uses the isolated deployment described in [deploy/README.md](deploy/README.md), available at `http://192.168.1.10:3100`. The commands below remain the generic standalone setup; use the explicitly scoped homelab commands when updating the live Pi.

Create `.env` with server-only secrets, then run:

```bash
docker compose up -d --build
```

The app will be available on port 3000. Use a Raspberry Pi with a 64-bit OS (ARM64). The image runs as a non-root user and stores SQLite in the `coach-data` named volume, which survives container replacement. Do not remove this volume during upgrades. The Docker build excludes `.env`, local databases and the Git directory. Keep the Garmin and OpenAI keys out of the repository and never prefix them with `NEXT_PUBLIC_`.

For local production mode, `npm run build && npm start` prepares the standalone server with its CSS/public assets and loads `.env`. The launcher resolves `DATABASE_PATH` to an absolute path before Next.js changes directory, so relative databases stay in the project's persistent `data` directory, outside `.next`. SQLite tables are created on first use; `npm run db:migrate` also initializes them explicitly. Back up SQLite with its online backup API rather than copying a live WAL database file alone.

For optional server-to-server jobs, set `SYNC_SECRET` to a random value of at least 16 characters and send it as `x-sync-secret`. This supports requests without browser Origin headers and is never entered in the app. The status route is `GET /api/garmin/status`.

## Quality checks

```bash
npm run lint
npm test
npm run typecheck
npm run format:check
npm run build
```

## Planned next slices

1. Detailed activity/FIT analysis for HR drift and stronger route comparisons.
2. Workout FIT export workflow.

The automated tests use an in-memory database and synthetic API responses. They cover pagination, retries, malformed data, token renewal, atomic failure recovery, duplicate prevention, corrections, Lisbon week boundaries, persisted schedules, competing workers, restart cooldowns, manual-sync coordination and cancellation. A real Garmin account test requires your own key and is not part of the test suite.


## Race visibility and road pacing

Registered events stay visible in the week strip even when recovery, a return review or an approved rest decision prevents prescribing them. Selecting the date shows **Not prescribed · needs review** and the reason. A registered event never silently becomes an extra workout. For example, a December 23 event is inside the three-day recovery window following a December 20 road race; its registration stays visible while the workout remains withheld.

In **Events → Road race pacing**, maintain a current Garmin prediction or confirm a completed whole-course road race/time trial. Evidence stays separate from editable event goals. Saving evidence never changes running targets, event duration or Garmin workout steps. Page reads calculate guidance locally and make no AI requests. Existing coach reviews receive sanitized pacing evidence/ranges without event names, GPS or reference identifiers; the same request caps remain.

Garmin predictions are user-reported estimates, fresh for 30 days in this app; confirmed road performances remain eligible for 90 days. Cross-distance road calculations use Riegel exponent 1.07, only up to 21.1 km and within a 2× distance ratio. Garmin predictions are used only at their entered distance. These are app limits, not a guarantee of race readiness. See the [Garmin explanation](https://www.garmin.com/en-US/blog/fitness/free-race-day-features-on-your-garmin-running-smartwatch/) and [Vickers & Vertosick study](https://doi.org/10.1186/s13102-016-0052-y).

A Garmin-only planning range is 5–10% slower than its estimate; a confirmed-result range is the estimate through 5% slower, rounded upward to 5 s/km. These margins are transparent heuristics, not validated uncertainty intervals or race-day forecasts. Readiness, road elevation/weather and execution remain unverified; recheck nearer the race. Training events show controlled effort, conflicting events have no execution-pace recommendation, and trails never receive a road-pace extrapolation. Regular run averages, matched HR/pace trends and event goal times cannot certify race performance or automatically accelerate a target.


### Trail long runs

In Plan, select the long-run day → **Change workout** → **Road / trail long run**. Enter the estimated total outing minutes (including hiking) and optional ascent, preview and apply. This is a per-workout choice, including a long run moved from Saturday; it does not change later weeks automatically. Distance, step lengths, weekly kilometres and any supporting session are preserved. **Road** restores the original prescription; schedule history supports guarded undo.

Trail steps use numeric RPE (main set 3–4/10, warm-up/cool-down 2–3/10). In Garmin Connect use **No Target** and copy the numeric RPE instructions into notes. HR remains feedback: hike steep climbs and avoid sustained excessive effort; no fixed road pace, uphill intervals or downhill sprints are added. Start on familiar terrain and increase ascent/technical difficulty separately from distance. Record as Garmin **Trail Run** to exclude it from road pace/HR comparisons. Trail practice supports terrain skills and aerobic development, but does not guarantee lower HR or faster race times.

Estimated planned load uses the supplied duration × RPE 4 (a planning heuristic, not measured effort or injury risk), and flags terrain demands for review alongside Friday Hyrox and Saturday cycling. Recorded time and optional actual session-RPE remain the load evidence. The coach can remove supporting sessions; selecting trail does not silently delete them. A recovery reduction keeps trail terrain, lowers RPE to 2–3, and removes original-road restoration metadata so it cannot restore a longer prescription. Race, break, past/recorded-session, Sunday, two-session and weekday two-hour lunch protections still apply.


### Race planning and running continuity

Training events are integrated into the reviewed distance budget, including the event warm-up/cool-down, and replace the long run/quality. Ordinary run distances are retained at recovery effort where the budget allows. Only excess distance is trimmed when a run can remain at least 5 km; otherwise a run may need removal. The app never adds catch-up distance or increases a reviewed week just to fit a race. At low weekly mileage, a long event plus the 5 km minimum can leave room for only one other run; maintaining both normal frequency and normal total is then impossible without revisiting those constraints.

Goal events keep an explicit taper. After initial rest (one day ordinarily, two for longer/hillier events, three at marathon distance), ordinary recovery runs keep their prescribed distances and nearby supporting sessions are removed. A trail label alone no longer selects the longer window: half-marathon distance, >=500 m ascent or >=120 estimated minutes do. Marathon-distance or >=240-minute events retain the reduced-distance major-event safeguard. These thresholds are transparent planning heuristics, not individualized physiological predictions.

Recent pain or high fatigue/soreness reports withhold post-race running; Garmin sleep/resting-HR caution flags can reduce distance. Missing daily check-ins alone never suppress ordinary post-race runs or certify readiness. Illness/injury/travel return reviews keep their stricter existing rules. Race conflicts, Sunday rest, fixed courses, minimum run distance and session/time limits remain. Removed runs are not automatically relocated to fill the week; initial rest can still reduce total distance after a demanding event. The week header labels race preparation/recovery and shows the reduction against the retained baseline rather than describing every week as a build.


### Milestone stages and counted mileage

The default roadmap follows **25, 27, 29, 23, 30, 32, 34, 27, 36… km**. Calendar stages are anchored to the starting Stage 1 week; a repeated legacy stage does not move that anchor. A reviewed return baseline can restart Stage 1. Past snapshots are retained. A stale current/next saved stage produces a correction proposal with one weekly approval, rather than silently replacing workouts. Current and next week can be prepared/accepted; later weeks are provisional milestone forecasts, never activations.

Running evidence, gaps, stale data, pauses, reported pain/high fatigue and Garmin recovery flags can still require an exception. Routine races and missing daily reports do not independently freeze the mileage milestone. The proposal spreads a supported increase across runs within recent single-run and weekday lunch limits before lowering its weekly target. It scales optional Hyrox and cycling first. It never adds a replacement ride automatically when removing support, and every retained ride still meets the one-hour minimum. Goal-race tapers, unresolved event conflicts and major-event recovery remain explicit exceptions.

An ordinary proposed event/recovery week can be arranged across available Monday–Saturday dates at recovery effort, retaining initial rest and avoiding three consecutive running days. A 23 km cutback after an 18 km trail event can therefore use three approximately 7.7 km runs instead of deleting the early-week mileage. Only full future/Monday proposals are rearranged; missed runs in a partial week are not packed into its remaining days. Feasibility includes the 5 km minimum, per-run cap, lunch limit, two sessions, availability, Sunday and recovery/event rules. Accepted event arrangements are saved in daily overrides, so they stay stable as the week advances. Preparation metadata prevents a saved goal taper being reduced again. Older per-run prescriptions stay at their legacy allocation until a new week is accepted (`planningVersion: 2`).

**Counted mileage** includes dedicated runs, their ordinary warm-ups/cool-downs, strides and recoveries, plus race-course distance. Hyrox never counts, even when the class includes running. Race warm-up/cool-down is outside the mileage target but remains in total running distance, minutes and physical/session-RPE load. No recorded activity is deleted or shortened. In **Progress → Race mileage**, associate an actual recording with its race and identify just its extra kilometres; for a separate warm-up/cool-down recording use its full distance, for a combined recording identify only the extra portion. This is explicit and reversible (0 restores all counted kilometres); no fixed distance is automatically subtracted from Garmin records. An additive `activity_mileage` table persists this attribution across syncs; corrected shorter recordings are clamped to avoid negative mileage.


During race recovery, Hyrox remains withheld for the whole recovery window. After initial rest, up to two non-consecutive **selected** cycling sessions per recovery week can remain as **Optional recovery cycling**, capped at 60 minutes (5 warm-up, 50 ride, 5 cool-down; main set 45–55% of current FTP). No unselected rides are added. Recorded rides count toward the limit, and recorded sessions are preserved. A past event needs a matching Garmin run and a successful sync within 48 hours; reported pain, moderate/high fatigue or soreness, Garmin recovery cautions, breaks/returns, approved rest, nearby race preparation, major events, unavailable slots and session limits can withhold rides. Future previews are conditional and rechecked daily; missing symptoms are unknown, so ride only with improving soreness, normal walking and no pain or unusual fatigue. Skip or stop rather than completing the hour or extending it for calories. Running kilometres/steps, Sunday rest and the weekly approval flow remain unchanged. No daily report is required and this local review makes no AI call.
