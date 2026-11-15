import type { TrainingPlan } from "./types/metrics";
import type { WeekSchedule } from "./types/schedule";
import { calendarMileage, workoutMileageKm } from "./mileage";
import { volumeMilestones, workoutKm } from "./training-plan";
export function weeklyMileageExplanation(
  plan: TrainingPlan,
  calendar: WeekSchedule,
) {
  const scheduledKm = calendarMileage(calendar, plan.easyPace).countedKm;
  const unresolved = calendar.days.filter(
    (d) =>
      d.race &&
      !d.sessions.some(
        (s) => s.session.sport === "running" && s.session.workout.race,
      ),
  );
  const changes = calendar.days.flatMap((d) => {
    const beforeKm = plan.workouts
      .filter((w) => w.dayOffset === d.dayOffset)
      .reduce((n, w) => n + workoutKm(w, plan.easyPace), 0);
    const afterKm = d.sessions.reduce(
      (n, s) =>
        n +
        (s.session.sport === "running"
          ? workoutMileageKm(s.session.workout, plan.easyPace)
          : 0),
      0,
    );
    return Math.abs(beforeKm - afterKm) < 0.005
      ? []
      : [
          {
            day: d.day,
            beforeKm,
            afterKm,
            reason:
              d.race &&
              !d.sessions.some(
                (s) => s.session.sport === "running" && s.session.workout.race,
              )
                ? "Registered race withheld; resolve participation in Events. Its course is excluded from scheduled mileage."
                : d.rule?.notes.join(" ") ||
                  (d.unavailableSlots?.length
                    ? "Availability changed workout placement."
                    : "Workout placement or distance adjusted within the weekly limits."),
          },
        ];
  });
  return {
    milestoneKm: volumeMilestones[plan.weekNumber - 1],
    baselineKm: plan.targetKm,
    scheduledKm,
    shortfallKm: Math.max(0, plan.targetKm - scheduledKm),
    unresolved,
    changes,
    provisionalRecovery: calendar.days.some((d) => d.rule?.provisional),
  };
}
