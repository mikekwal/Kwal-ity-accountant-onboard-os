"use client";
import { useParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { FIRM } from "@/lib/data";

export default function Portal() {
  const { id } = useParams<{ id: string }>();
  const { engagements, update, log, transition } = useStore();
  const e = engagements.find((x) => x.id === id);
  if (!e) return <p className="p-6 text-sm">This link is not valid.</p>;

  const req = e.slots.filter((s) => s.required);
  const done = req.filter((s) => s.status !== "missing").length;

  const upload = (code: string) => {
    const first = e.state === "DOCS_REQUESTED";
    update(e.id, (x) => ({ ...x, slots: x.slots.map((s) => (s.code === code ? { ...s, status: "received", file: `${code.toLowerCase()}_upload.pdf` } : s)) }));
    log(e.id, `Client uploaded ${code} (scanned, moved from quarantine)`, "client");
    if (first) transition(e.id, "DOCS_IN_PROGRESS", "First document uploaded");
  };
  const dontHave = (code: string) => {
    update(e.id, (x) => ({ ...x, slots: x.slots.map((s) => (s.code === code ? { ...s, status: "waived", note: "Client: I don't have this" } : s)) }));
    log(e.id, `Client marked ${code} as not available`, "client");
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2.5 px-4">
          <span className="grid size-7 place-items-center rounded-md bg-brand text-[11px] font-semibold text-white">NB</span>
          <span className="text-sm font-semibold">{FIRM.name}</span>
          <span className="ml-auto text-xs text-ink-3">Secure upload · verified by text code</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Hi {e.contact.split(" ")[0]}, here&apos;s what we need</h1>
        <p className="mt-2 text-sm text-ink-2">Upload each document into its own slot. You can do this over several visits; we&apos;ll remind you about anything still missing.</p>

        <div className="card mt-6 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{done} of {req.length} done</span>
            <span className="text-ink-3">{e.service} · {e.taxYear}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${req.length ? (done / req.length) * 100 : 0}%` }} />
          </div>
        </div>

        {e.slots.length === 0 ? (
          <p className="card mt-4 p-6 text-center text-sm text-ink-2">Your checklist will appear here after your kickoff meeting.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {e.slots.map((s) => (
              <li key={s.code} className="card flex flex-wrap items-center gap-3 p-4">
                <span className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${s.status === "missing" ? "bg-sunken text-ink-3" : "bg-ok-soft text-ok"}`}>
                  {s.status === "missing" ? "" : "✓"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-ink-3">
                    {s.status === "received" ? `Received: ${s.file}` : s.status === "waived" ? (s.note ?? "Not needed") : "PDF, JPG, PNG or HEIC · up to 25 MB"}
                  </p>
                </div>
                {s.status === "missing" && (
                  <div className="flex gap-2">
                    <button className="btn" onClick={() => dontHave(s.code)}>I don&apos;t have this</button>
                    <button className="btn btn-primary" onClick={() => upload(s.code)}>Upload</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-center text-xs text-ink-3">Files are encrypted and go straight to {FIRM.short}. For your security, documents can&apos;t be downloaded from this portal.</p>
      </main>
    </div>
  );
}
