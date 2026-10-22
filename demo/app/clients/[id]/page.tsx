"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { StaffShell, StateChip, Flag, Avatar, money, fmt } from "@/components/ui";
import { useStore } from "@/lib/store";
import { TRANSITIONS, STATE_LABEL } from "@/lib/pipeline";
import { STAFF, isStalled, daysIn, staleAt, briefFor, draftFor } from "@/lib/data";

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const { engagements, transition, userId, update, log } = useStore();
  const e = engagements.find((x) => x.id === id);
  const [showDraft, setShowDraft] = useState(false);
  if (!e) return <StaffShell><p className="text-sm text-ink-2">Client not found. <Link className="underline" href="/">Back to board</Link></p></StaffShell>;

  const me = STAFF.find((u) => u.id === userId)!;
  const edges = TRANSITIONS[e.state] ?? [];
  const brief = briefFor(e);
  const draft = draftFor(e);
  const st = isStalled(e);
  const subtotal = e.quote.reduce((s, l) => s + l.fee, 0);
  const total = Math.round(subtotal * (1 - e.discount / 100));
  const req = e.slots.filter((s) => s.required);
  const done = req.filter((s) => s.status !== "missing").length;
  const sa = staleAt(e);

  const setSlot = (code: string, patch: Partial<(typeof e.slots)[number]>, action: string) => {
    update(e.id, (x) => ({ ...x, slots: x.slots.map((s) => (s.code === code ? { ...s, ...patch } : s)) }));
    log(e.id, action);
  };

  return (
    <StaffShell>
      <Link href="/" className="text-sm text-ink-2 hover:text-ink">← Board</Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{e.name}</h1>
            <StateChip state={e.state} />
            {st && <Flag tone="danger">Stalled · {daysIn(e)}d in stage</Flag>}
            {e.intakeMissing && <Flag tone="warn">Booked without intake</Flag>}
          </div>
          <p className="mt-1 text-sm text-ink-2">
            {e.service} · Tax year {e.taxYear} · {e.contact} · {e.email} · {e.phone}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-ink-2"><Avatar id={e.ownerId} /> Owner: {STAFF.find((u) => u.id === e.ownerId)!.name}</div>
      </div>

      {edges.length > 0 && (
        <div className="card mt-4 flex flex-wrap items-center gap-2 p-3">
          <span className="mr-1 text-xs font-medium text-ink-3">NEXT STEP</span>
          {edges.map((ed, i) => {
            const blocked = ed.ownerOnly && me.role !== "owner";
            const docsBlock = ed.to === "PENDING_APPROVAL" && e.state === "DOCS_COMPLETE" ? false : false;
            return (
              <button
                key={i}
                disabled={blocked || docsBlock}
                title={blocked ? "Owner approval required (switch user to Dana Whitfield)" : undefined}
                onClick={() => transition(e.id, ed.to, ed.label)}
                className={`btn ${ed.tone === "primary" ? "btn-primary" : ed.tone === "danger" ? "btn-danger" : ""}`}
              >
                {ed.label}{blocked ? " · owner only" : ""}
              </button>
            );
          })}
          {sa && <span className="ml-auto text-xs text-ink-3">{st ? "Went stale" : "Goes stale"} {fmt(sa.toISOString())}</span>}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          {e.intakeMissing && (
            <section className="card border-warn/30 bg-warn-soft/40 p-4">
              <h2 className="text-sm font-semibold text-warn">Intake form not received</h2>
              <p className="mt-1 text-sm text-ink-2">This prospect booked on Calendly but has not completed the intake form. A reminder is drafted, not sent.</p>
              <div className="mt-3 flex gap-2">
                <button className="btn" onClick={() => log(e.id, "Intake reminder drafted in Gmail")}>Draft reminder</button>
                <button className="btn" onClick={() => { update(e.id, (x) => ({ ...x, intakeMissing: false })); log(e.id, "Intake matched by email", "system"); }}>Simulate: intake arrives</button>
              </div>
            </section>
          )}

          <section className="card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Pre-meeting brief</h2>
              <span className="text-[11px] text-ink-3">Claude on Vertex AI · from intake + public website · IDs redacted</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{brief.who}</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Likely services</h3>
                <ul className="mt-1.5 space-y-1 text-sm">{brief.services.map((s) => <li key={s}>• {s}</li>)}</ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Questions to ask</h3>
                <ul className="mt-1.5 space-y-1 text-sm">{brief.questions.map((s) => <li key={s}>• {s}</li>)}</ul>
              </div>
            </div>
            {brief.flags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{brief.flags.map((f) => <Flag key={f} tone="warn">{f}</Flag>)}</div>}
          </section>

          <section className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Pre-meeting email</h2>
              {e.draftStatus === "none" && <Flag tone="muted">Not drafted yet</Flag>}
              {e.draftStatus === "drafted" && <Flag tone="warn">Draft in {STAFF.find((u) => u.id === e.ownerId)!.name.split(" ")[0]}&apos;s Gmail</Flag>}
              {e.draftStatus === "sent" && <Flag tone="ok">Sent by staff</Flag>}
            </div>
            <p className="mt-1 text-xs text-ink-3">Meeting: {fmt(e.meetingAt)} · The system only creates drafts. A person sends.</p>
            {e.draftStatus !== "none" && (
              <>
                <button className="btn mt-3" onClick={() => setShowDraft((v) => !v)}>{showDraft ? "Hide draft" : "Preview draft"}</button>
                {showDraft && (
                  <div className="mt-3 rounded-lg border border-line bg-canvas p-3 text-sm">
                    <p className="text-ink-3">To: {draft.to}</p>
                    <p className="font-medium">Subject: {draft.subject}</p>
                    <pre className="mt-2 whitespace-pre-wrap font-sans leading-relaxed text-ink-2">{draft.body}</pre>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Document checklist</h2>
              {req.length > 0 && <span className="text-xs text-ink-3">{done} of {req.length} received or waived</span>}
            </div>
            {e.slots.length === 0 ? (
              <p className="mt-2 text-sm text-ink-3">Created at kickoff from intake answers using the firm&apos;s document rules.</p>
            ) : (
              <>
                <ul className="mt-3 divide-y divide-line">
                  {e.slots.map((s) => (
                    <li key={s.code} className="flex flex-wrap items-center gap-3 py-2.5">
                      <span className={`size-2 rounded-full ${s.status === "received" ? "bg-ok" : s.status === "waived" ? "bg-ink-3" : "bg-danger"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{s.label}</p>
                        <p className="text-[11px] text-ink-3">{s.reason}{s.file ? ` · ${s.file}` : ""}{s.note ? ` · Waived: ${s.note}` : ""}</p>
                      </div>
                      {s.status === "missing" ? (
                        <div className="flex gap-1.5">
                          <button className="btn h-8 min-h-0" onClick={() => setSlot(s.code, { status: "waived", note: "Not applicable this year" }, `Slot waived: ${s.code}`)}>Waive</button>
                        </div>
                      ) : (
                        <Flag tone={s.status === "received" ? "ok" : "muted"}>{s.status === "received" ? "Received" : "Waived"}</Flag>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link className="btn" href={`/portal/${e.id}`} target="_blank">Open client portal view ↗</Link>
                  {e.state.startsWith("DOCS") && e.state !== "DOCS_COMPLETE" && req.every((s) => s.status !== "missing") && (
                    <button className="btn btn-primary" onClick={() => transition(e.id, "DOCS_COMPLETE", "All required documents received")}>Mark docs complete</button>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="card p-4">
            <h2 className="text-sm font-semibold">Quote</h2>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {e.quote.map((l) => (
                  <tr key={l.label} className="border-b border-line"><td className="py-1.5">{l.label}</td><td className="py-1.5 text-right tabular-nums">{money(l.fee)}</td></tr>
                ))}
                {e.discount > 0 && <tr className="border-b border-line text-warn"><td className="py-1.5">Discount ({e.discount}%) · needs owner approval</td><td className="py-1.5 text-right tabular-nums">−{money(subtotal - total)}</td></tr>}
                <tr><td className="py-1.5 font-semibold">Total</td><td className="py-1.5 text-right font-semibold tabular-nums">{money(total)}</td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink-3">Fee schedule from firm config. Engagement letter is sent through DocuSign on owner approval.</p>
          </section>
        </div>

        <aside className="card h-fit p-4 lg:sticky lg:top-20">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Audit timeline</h2>
            <Flag tone="ok">Chain verified</Flag>
          </div>
          <p className="mt-1 text-[11px] text-ink-3">Append-only. Every change and every human approval.</p>
          <ol className="mt-3 space-y-3">
            {[...e.events].reverse().map((ev, i) => (
              <li key={i} className="relative border-l border-line pl-3">
                <span className="absolute -left-[4px] top-1.5 size-[7px] rounded-full bg-brand" />
                <p className="text-sm">{ev.action}</p>
                <p className="text-[11px] text-ink-3">
                  {fmt(ev.at)} · {ev.actor} ({ev.actorType})
                  {ev.to && ev.from ? ` · ${STATE_LABEL[ev.from]} → ${STATE_LABEL[ev.to]}` : ""}
                </p>
                <p className="font-mono text-[10px] text-ink-3">#{ev.hash}</p>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </StaffShell>
  );
}
