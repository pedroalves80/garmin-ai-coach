import type { ReactNode } from "react";

type StatusBadgeProps = {
  children: ReactNode;
  tone?: "info" | "success" | "warning";
};

export function StatusBadge({ children, tone = "info" }: StatusBadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
