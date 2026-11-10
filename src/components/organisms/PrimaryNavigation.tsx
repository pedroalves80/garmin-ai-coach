"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/atoms/Icon";

const items = [
  { href: "/", label: "Today", icon: "today" },
  { href: "/plan", label: "Plan", icon: "plan" },
  { href: "/events", label: "Events", icon: "events" },
  { href: "/coach", label: "Coach", icon: "coach" },
  { href: "/progress", label: "Progress", icon: "progress" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;
const legacy: Record<string, string> = {
  "#connection": "/settings",
  "#plan": "/plan",
  "#coach": "/coach",
  "#progress": "/progress",
};
export function PrimaryNavigation() {
  const pathname = usePathname(),
    checkedLegacy = useRef(false);
  useEffect(() => {
    if (checkedLegacy.current) return;
    checkedLegacy.current = true;
    // A full replacement keeps the old hash redirect out of the route cache.
    if (pathname === "/" && legacy[window.location.hash])
      window.location.replace(legacy[window.location.hash]);
  }, [pathname]);
  return (
    <nav className="primary-nav" aria-label="Primary navigation">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={pathname === item.href ? "page" : undefined}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
