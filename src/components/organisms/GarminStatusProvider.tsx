"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { GarminStatus } from "@/shared/types/sync";
const Context = createContext<{
  status: GarminStatus | null;
  statusError: boolean;
} | null>(null);
export function GarminStatusProvider({ children }: { children: ReactNode }) {
  const router = useRouter(),
    seenSync = useRef<string | null | undefined>(undefined),
    seenDay = useRef<string | undefined>(undefined);
  const [status, setStatus] = useState<GarminStatus | null>(null),
    [statusError, setStatusError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading || document.hidden) return;
      loading = true;
      try {
        const response = await fetch("/api/garmin/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Status unavailable");
        const next: GarminStatus = await response.json();
        setStatus(next);
        setStatusError(false);
        if (
          next.lastSync !== seenSync.current ||
          (next.day !== undefined && next.day !== seenDay.current)
        )
          router.refresh();
        seenDay.current = next.day;
        seenSync.current = next.lastSync;
      } catch {
        if (!controller.signal.aborted) setStatusError(true);
      } finally {
        loading = false;
      }
    }
    const timer = setInterval(() => void load(), 30_000);
    document.addEventListener("visibilitychange", load);
    window.addEventListener("garmin-synced", load);
    window.addEventListener("focus", load);
    void load();
    return () => {
      clearInterval(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", load);
      window.removeEventListener("garmin-synced", load);
      window.removeEventListener("focus", load);
    };
  }, [router]);
  return (
    <Context.Provider value={{ status, statusError }}>
      {children}
    </Context.Provider>
  );
}
export function useGarminStatus() {
  const value = useContext(Context);
  if (!value) throw new Error("Garmin status needs its provider.");
  return value;
}
