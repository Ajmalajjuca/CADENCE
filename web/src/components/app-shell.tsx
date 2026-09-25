"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const destinations = [
  { href: "/create", label: "Create" },
  { href: "/ideas", label: "Ideas" },
  { href: "/library", label: "Library" },
  { href: "/profile", label: "Voice & Profile" },
  { href: "/settings", label: "Settings" },
] as const;

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div className="app-shell">
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" className="brand" aria-label="Cadence home">Cadence<span aria-hidden="true">.</span></Link>
        <nav aria-label="Main navigation" className="main-nav">
          {destinations.map((destination) => <Link
            key={destination.href}
            href={destination.href}
            aria-current={isCurrent(pathname, destination.href) ? "page" : undefined}
            className="nav-link"
          >
            {destination.label}
          </Link>)}
        </nav>
      </div>
    </header>
    <div className="app-content">{children}</div>
    <footer className="app-footer">Cadence · Your words, your approval, your LinkedIn account.</footer>
  </div>;
}
