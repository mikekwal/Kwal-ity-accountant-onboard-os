"use client";
import Link from "next/link";
import { StaffShell, StateChip, Flag, Avatar } from "@/components/ui";
import { useStore } from "@/lib/store";
import { COLUMNS } from "@/lib/pipeline";
import { isStalled, daysIn } from "@/lib/data";

export default function Board() {
  const { engagements } = useStore();
  const open = engagements.filter((e) => COLUMNS.some((c) => c.states.includes(e.state)) && e.state !== "ACTIVE");
  const stalled = open.filter(isStalled).length;
  const noIntake = engagements.filter((e) => e.intakeMissing && e.state === "BOOKED").length;

  return (
    <StaffShell>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Onboarding pipeline</h1>
          <p className="mt-1 text-sm text-ink-2">Every new client, one record, one state. Stalled work rises to the top.</p>
        </div>
        <div className="flex gap-2">
          <Stat label="In onboarding" value={open.length} />
          <Stat label="Stalled" value={stalled} tone={stalled ? "danger" : undefined} />
          <Stat label="Booked, no intake" value={noIntake} tone={noIntake ? "warn" : undefined} />
        </div>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        <div className="flex min-w-max gap-3">
          {COLUMNS.map((col) => {
            const items = engagements
              .filter((e) => col.states.includes(e.state))
              .sort((a, b) => Number(isStalled(b)) - Number(isStalled(a)) || daysIn(b) - daysIn(a));
            return (
              <section key={col.key} className="flex w-[264px] flex-col rounded-xl bg-sunken/70 p-2" aria-label={col.title}>
                <header className="flex items-center justify-between px-2 pb-2 pt-1">
                  <h2 className="text-[13px] font-semibold">{col.title} <span className="ml-1 font-normal text-ink-3">{items.length}</span></h2>
                  <span className="text-[11px] text-ink-3">{col.owner}</span>
                </header>
                <div className="flex flex-col gap-2">
                  {items.length === 0 && <p className="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-xs text-ink-3">Nothing here</p>}
                  {items.map((e) => {
                    const st = isStalled(e);
                    const req = e.slots.filter((s) => s.required);
                    const done = req.filter((s) => s.status !== "missing").length;
                    return (
                      <Link
                        key={e.id}
                        href={`/clients/${e.id}`}
                        className={`card block p-3 transition-[border-color,transform] duration-150 hover:border-line-strong active:scale-[0.99] ${st ? "border-l-[3px] border-l-danger" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{e.name}</p>
                            <p className="mt-0.5 text-xs text-ink-3">{e.service}</p>
                          </div>
                          <Avatar id={e.ownerId} />
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          {col.states.length > 1 && <StateChip state={e.state} />}
                          {st && <Flag tone="danger">Stalled · {daysIn(e)}d</Flag>}
                          {e.intakeMissing && <Flag tone="warn">No intake</Flag>}
                          {!st && <span className="text-[11px] text-ink-3">{daysIn(e)}d in stage</span>}
                        </div>
                        {req.length > 0 && e.state.startsWith("DOCS") && (
                          <div className="mt-2.5">
                            <div className="h-1 overflow-hidden rounded-full bg-sunken">
                              <div className="h-full rounded-full bg-brand" style={{ width: `${(done / req.length) * 100}%` }} />
                            </div>
                            <p className="mt-1 text-[11px] text-ink-3">{done} of {req.length} documents</p>
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </StaffShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warn" }) {
  const c = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="card min-w-[112px] px-3 py-2">
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${c}`}>{value}</p>
    </div>
  );
}
