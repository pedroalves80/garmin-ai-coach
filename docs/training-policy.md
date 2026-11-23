# Training rules and evidence

[Project overview](../README.md) · [User guide](usage.md)

These are the app's current planning rules, not universal training recommendations or medical clearance. They describe a running-first template with supporting Hyrox and cycling.

## Calendar constraints

- Running takes priority; cycling never replaces a run.
- At most two workouts are prescribed per day.
- Weekday lunch is limited to two hours. Later weekday sessions and Saturday have no availability cap.
- Hyrox classes are Monday, Wednesday and optionally Friday, with independent attendance choices.
- Sunday is rest unless an explicit race is scheduled there.
- Ordinary generated runs total at least 5 km, including warm-up and cool-down. Running steps use distance. Races retain their fixed course distance.
- Prescribed cycling totals at least 60 minutes; skipping or stopping a ride remains valid.

Missed distance is not accumulated or packed into a partial week. Recorded history is not deleted to enforce a planning limit.

## Volume and ongoing blocks

The initial milestone sequence, in kilometres, is:

```text
25, 27, 29, 23, 30, 32, 34, 27, 36, 39,
42, 36, 45, 48, 52, 44, 55, 58, 62, 52,
64, 68, 72, 60, 70, 74, 78, 66, 76, 80
```

Six consolidation weeks follow at 76, 78, 64, 78, 80 and 64 km. Subsequent four-week performance blocks repeat 76, 78, 80 and 64 km. Week numbering continues indefinitely; browsing and event entry use a rolling two-year future horizon.

Milestones are ceilings and forecasts, not guaranteed dates or automatic prescriptions. Completed training, recovery, gaps, events, availability and per-run constraints inform the actual proposal. Supporting training is reviewed before reducing running, but a constraint can still require less distance. A return from a break does not silently restore a former peak.

The default ceiling is 80 km. A separate review can enable 85 or 90 km after the initial build/consolidation and sufficient recent approved, recorded training near the existing ceiling. This changes later proposals, not existing approved weeks, targets or FTP.

## Running quality and intensity

Tempo working distance can progress with supported mileage and repeated exposure to the current dose. Extra tempo replaces base distance within the same weekly total. Cutbacks, recovery, breaks and relevant events hold quality progression.

Pace and HR increases require a separate current target/evidence review; they do not rise just because weekly volume rises. Distance matches and whole-activity averages cannot prove that every interval was completed.

Strides remain six 80 m repetitions with 250 m recoveries. They develop short, controlled accelerations and are not judged by reaching high HR. Trail work uses numeric effort and preserves terrain context; road pace comparisons are not applied to trail activities.

## Counted mileage and physical load

Counted mileage includes dedicated running, ordinary warm-up/cool-down, strides, interval recoveries and race-course distance. Running inside Hyrox does not count.

Race warm-up/cool-down stays in total recorded running and physical load, outside the milestone target. Attribution is explicit and reversible in Progress; the app does not guess and subtract a standard distance from recordings.

Optional session effort ratings provide duration × RPE load estimates. Missing ratings are unknown, not zero load. Planned load and review thresholds are heuristics rather than injury predictions.

## Race preparation

A race replaces ordinary training on its date and can replace the week's long run or quality work. Goal events retain a taper. Where a full-week proposal can fit the reviewed distance around event/rest constraints, it may redistribute runs across available days. It does not refill a partially completed week.

Recovery and taper defaults use entered event details, then a matching Garmin recording when available. A demanding event is one lasting at least 120 minutes, covering at least 21.1 km, or having at least 500 m ascent. A trail label alone does not set a longer window.

| Event category                          | Initial rest | Recovery window |
| --------------------------------------- | ------------ | --------------- |
| Ordinary shorter event                  | 1 day        | 3 days          |
| Demanding event below marathon distance | 2 days       | 7 days          |
| Marathon distance or longer             | 3 days       | 14 days         |

Marathon distance or a recorded/estimated duration of at least four hours retains a major-event safeguard with reduced recovery distance. Overlapping events may remain registered but unprescribed until participation is resolved.

## Post-race recovery

After initial rest, ordinary post-race runs retain their prescribed distances where the calendar and recovery evidence permit. There is no universal 5 km cap on every post-race run. Known symptoms or Garmin caution flags can still reduce or withhold training.

Hyrox, tempo and strides stay withheld through the recovery window. Up to two already-selected, non-consecutive cycling sessions per recovery week may remain as optional 60-minute recovery rides, with a main set at 45–55% FTP. Initial rest, stale sync, known symptoms, major events, nearby races and other calendar restrictions can withhold them.

### Automatic return to base effort

An automatic assessment may restore the existing base range for upcoming, unmodified runs when all required evidence is available:

1. Initial rest is over and a matching non-major Garmin race recording exists.
2. At least two distinct completed recovery-run days match prescription versions known at activity start, meet distance and have usable aerobic average HR.
3. Garmin sync is successful and no more than 48 hours old.
4. Recent sleep/resting-HR coverage is supportive, including a usable overnight record after the latest completed run without a new latest-night flag.
5. No known pain, relevant fatigue/soreness, harder feedback, recent demanding support or conflicting break/race constraint blocks the decision.

A previously restored base run may maintain the decision after another supportive night. It cannot substitute for the first two recovery-run days. New concerns or stale evidence can restore recovery effort; explicit day edits remain protected.

Comparable pace/HR is used only as an additional concern flag when at least three similar pre-race road references exist. Matching considers HR, start location, distance, climbing and temperature. A run over 12% slower is a conservative review flag. Missing/dissimilar conditions or trail-versus-road data are not compared, and missing comparisons do not invent a fitness trend.

The app explains the assessment in Plan and Events. Daily check-ins are optional. An optional manual return-to-base review remains available when automatic evidence is incomplete. Neither path establishes absence of pain or full muscular recovery.

## Training breaks

Dated or indefinite travel, illness, injury and rest breaks suppress all uncompleted sports and take precedence over events. Return requires an explicit review with current symptom and sync evidence.

The reduced return phase does not restore the previous mileage automatically. A separate baseline review and recorded return running are required before normal progression resumes. Previously saved future weeks can become pending review. These stricter break-return rules are distinct from automatic post-race base reassessment.

## Evidence limits

A matched recording identifies a likely prescription, not complete step execution. Grouped splits, attached workout metadata and average HR do not establish time in target. Legacy or later-captured prescriptions cannot prove historical targets.

Road-race guidance distinguishes entered goals, user-reported Garmin predictions and confirmed race/time-trial results. Trail events use effort. Wearable estimates and self-reports are not laboratory calibration, and the app does not promise a finish time, lower HR or freedom from injury.
