"use client";
import Link from "next/link";
import { StaffShell, Flag, Avatar } from "@/components/ui";
import { useStore } from "@/lib/store";
import { COLUMNS } from "@/lib/pipeline";
import { isStalled, daysIn, STAFF } from "@/lib/data";

export default function Dashboard() {
  const { engagements } = useStore();
  const max = Math.max(...COLUMNS.map((c) => engagements.filter((e) => c.states.includes(e.state)).length), 1);
  const stalled = engagements.filter(isStalled);
  const booked = engagements.length;
  const noIntake = engagements.filter((e) => e.intakeMissing).length;

  return (
    <StaffShell>
      <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-ink-2">Where clients are, where they stall, and the morning digest each owner receives.</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Kpi label="Clients in pipeline" value={String(booked)} />
        <Kpi label="Stalled now" value={String(stalled.length)} tone="danger" />
        <Kpi label="Booked without intake" value={`${Math.round((noIntake / booked) * 100)}%`} tone="warn" />
        <Kpi label="Median days to signed letter" value="18" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Clients by stage</h2>
          <ul className="mt-3 space-y-2.5">
            {COLUMNS.map((c) => {
              const n = engagements.filter((e) => c.states.includes(e.state)).length;
              return (
                <li key={c.key} className="grid grid-cols-[110px_1fr_28px] items-center gap-3 text-sm">
                  <span className="text-ink-2">{c.title}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${(n / max) * 100}%` }} />
                  </div>
                  <span className="text-right tabular-nums">{n}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Morning digest preview</h2>
            <span className="text-[11px] text-ink-3">Sent 7:30 AM to owners · internal only</span>
          </div>
          {stalled.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">Nothing stalled. Nice.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {stalled.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2.5">
                  <Avatar id={e.ownerId} />
                  <Link href={`/clients/${e.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">{e.name}</Link>
                  <Flag tone="danger">{daysIn(e)}d stuck</Flag>
                  <span className="hidden text-xs text-ink-3 sm:inline">{STAFF.find((u) => u.id === e.ownerId)!.name.split(" ")[0]}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-3">Client nudges for stalled document and letter stages are drafted in Gmail for staff to review and send.</p>
        </section>
      </div>
    </StaffShell>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warn" }) {
  const c = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="card p-4">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${c}`}>{value}</p>
    </div>
  );
}
