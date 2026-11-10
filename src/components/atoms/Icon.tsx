type IconName =
  | "today"
  | "plan"
  | "events"
  | "coach"
  | "progress"
  | "settings"
  | "arrow"
  | "check"
  | "heart";
const paths: Record<IconName, string[]> = {
  today: ["M3 10.5 12 3l9 7.5", "M5 9v11h5v-6h4v6h5V9"],
  plan: [
    "M7 3v4m10-4v4M4 10h16",
    "M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z",
    "M8 14h2m4 0h2m-8 3h2",
  ],
  events: ["M5 21V3", "M5 4h14l-3 4 3 4H5"],
  coach: ["m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"],
  progress: ["M4 4v16h17", "m7 14 4-5 4 3 5-7"],
  settings: [
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
    "m9 3-.7 2.1L6 6l-2.1.7v3L2 12l1.9 2.3v3L6 18l2.3.9L9 21h6l.7-2.1L18 18l2.1-.7v-3L22 12l-1.9-2.3v-3L18 6l-2.3-.9L15 3H9Z",
  ],
  arrow: ["M4 12h15m-6-6 6 6-6 6"],
  check: ["m5 12 4 4L19 6"],
  heart: [
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  ],
};
export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name].map((d, i) => (
        <path d={d} key={i} />
      ))}
    </svg>
  );
}
