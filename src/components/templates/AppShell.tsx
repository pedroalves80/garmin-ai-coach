import Link from "next/link";
import type { ReactNode } from "react";
import { PrimaryNavigation } from "@/components/organisms/PrimaryNavigation";
import { GarminStatusProvider } from "@/components/organisms/GarminStatusProvider";

function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Run coach home">
      <span className="brand-symbol" aria-hidden="true">
        r<span>↗</span>
      </span>
      <span>run coach</span>
    </Link>
  );
}
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <GarminStatusProvider>
      <div className="app-frame">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <aside className="app-sidebar">
          <Brand />
          <PrimaryNavigation />
          <div className="sidebar-footer">
            <span className="status-dot" />
            Personal workspace<p>Running · Hyrox · Cycling</p>
          </div>
        </aside>
        <div className="app-main">
          <header className="mobile-header">
            <Brand />
            <span className="local-label">
              <span className="status-dot" />
              Personal
            </span>
          </header>
          <main id="main-content" className="page-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </GarminStatusProvider>
  );
}
