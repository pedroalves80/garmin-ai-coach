export type PlanningPolicy = {
  ceilingKm: 80 | 85 | 90;
  effectiveFrom: string | null;
  reviewedAt: string | null;
};
export const DEFAULT_PLANNING_POLICY: PlanningPolicy = {
  ceilingKm: 80,
  effectiveFrom: null,
  reviewedAt: null,
};
export const volumeMilestones = [
  25, 27, 29, 23, 30, 32, 34, 27, 36, 39, 42, 36, 45, 48, 52, 44, 55, 58, 62,
  52, 64, 68, 72, 60, 70, 74, 78, 66, 76, 80,
];
export const MAX_RUNNING_KM = 90;
export function trainingCycle(
  week: number,
  policy: PlanningPolicy = DEFAULT_PLANNING_POLICY,
  start?: string,
) {
  if (!Number.isSafeInteger(week) || week < 1)
    throw new Error("Choose a positive training week.");
  if (week <= 30)
    return {
      km: volumeMilestones[week - 1],
      cutback: week % 4 === 0,
      phase: "build" as const,
      block: 1,
      weekInBlock: week,
      label: `Stage ${week} of 30 · build towards 80 km`,
      ceilingKm: 80,
    };
  if (week <= 36) {
    const n = week - 31;
    return {
      km: [76, 78, 64, 78, 80, 64][n],
      cutback: n === 2 || n === 5,
      phase: "consolidation" as const,
      block: 1,
      weekInBlock: n + 1,
      label: `80 km consolidation · week ${n + 1} of 6`,
      ceilingKm: 80,
    };
  }
  const active =
    policy.ceilingKm > 80 &&
    policy.effectiveFrom &&
    start &&
    start >= policy.effectiveFrom;
  const offset = active
    ? Math.max(
        0,
        Math.round(
          (Date.parse(start + "T12:00:00Z") -
            Date.parse(policy.effectiveFrom + "T12:00:00Z")) /
            (7 * 86400000),
        ),
      )
    : week - 37;
  const block = Math.floor(offset / 4),
    position = offset % 4;
  const peak = active ? Math.min(policy.ceilingKm, 86 + 4 * block) : 80;
  const km = active
    ? [peak - 4, peak - 2, peak, Math.round(peak * 0.8)][position]
    : [76, 78, 80, 64][position];
  const phase =
    active && peak < policy.ceilingKm
      ? ("optional_build" as const)
      : ("performance" as const);
  return {
    km,
    cutback: position === 3,
    phase,
    block: block + 1,
    weekInBlock: position + 1,
    label: `${active ? `${policy.ceilingKm} km reviewed ceiling` : "Ongoing performance"} · block ${block + 1}, week ${position + 1} of 4`,
    ceilingKm: active ? policy.ceilingKm : 80,
  };
}
