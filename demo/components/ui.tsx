"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { FIRM, STAFF } from "@/lib/data";
import { State, STATE_LABEL, TERMINAL } from "@/lib/pipeline";
import { useStore } from "@/lib/store";

export function StaffShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { userId, setUserId, reset } = useStore();
  const nav = [
    { href: "/", label: "Board" },
    { href: "/dashboard", label: "Dashboard" },
  ];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-md bg-brand text-[11px] font-semibold text-white">OS</span>
            <span className="whitespace-nowrap text-sm font-semibold">Onboarding OS</span>
            <span className="hidden text-sm text-ink-3 sm:inline">· {FIRM.name}</span>
          </Link>
          <nav className="flex gap-1">
            {nav.map((n) => {
              const active = n.href === "/" ? path === "/" || path.startsWith("/clients") : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:text-ink"}`}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-[11px] font-medium text-ok md:inline-flex">
              <span className="size-1.5 rounded-full bg-ok" /> Google SSO · 2-Step verified
            </span>
            <select
              aria-label="Signed in as"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="h-8 rounded-md border border-line bg-surface px-2 text-sm"
            >
              {STAFF.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </select>
            <button className="btn h-8 min-h-0" onClick={reset} title="Reset demo data">Reset</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

const CHIP: Partial<Record<State, string>> = {
  ACTIVE: "bg-ok-soft text-ok",
  CANCELED: "bg-sunken text-ink-3",
  NO_SHOW: "bg-sunken text-ink-3",
  NOT_A_FIT: "bg-sunken text-ink-3",
  LOST: "bg-sunken text-ink-3",
  CHANGE_REVIEW: "bg-warn-soft text-warn",
};
export function StateChip({ state }: { state: State }) {
  const cls = CHIP[state] ?? (TERMINAL.includes(state) ? "bg-sunken text-ink-3" : "bg-brand-soft text-brand");
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{STATE_LABEL[state]}</span>;
}

export function Flag({ tone, children }: { tone: "danger" | "warn" | "ok" | "muted"; children: ReactNode }) {
  const cls = { danger: "bg-danger-soft text-danger", warn: "bg-warn-soft text-warn", ok: "bg-ok-soft text-ok", muted: "bg-sunken text-ink-2" }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

export function Avatar({ id }: { id: string }) {
  const u = STAFF.find((s) => s.id === id)!;
  return (
    <span title={u.name} className="grid size-6 place-items-center rounded-full bg-sunken text-[10px] font-semibold text-ink-2">{u.initials}</span>
  );
}

export const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: FIRM.tz });
