"use client";
// Demo state lives in the browser (localStorage). The real build writes to Postgres via transition().
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Engagement, SEED_ENGAGEMENTS, NOW, STAFF, fakeHash, slotsFor, AuditEvent } from "./data";
import { State } from "./pipeline";

type Store = {
  engagements: Engagement[];
  userId: string;
  setUserId: (id: string) => void;
  transition: (id: string, to: State, action: string) => void;
  log: (id: string, action: string, actorType?: AuditEvent["actorType"]) => void;
  update: (id: string, fn: (e: Engagement) => Engagement) => void;
  reset: () => void;
};

const Ctx = createContext<Store | null>(null);
const KEY = "onboarding-os-demo-v1";

// Demo clock: real elapsed time added onto the fixed demo "now".
const started = Date.now();
const nowIso = () => new Date(NOW.getTime() + (Date.now() - started)).toISOString();

function append(e: Engagement, ev: Omit<AuditEvent, "hash" | "at">): Engagement {
  const prev = e.events[e.events.length - 1]?.hash ?? "genesis";
  const at = nowIso();
  return { ...e, events: [...e.events, { ...ev, at, hash: fakeHash(prev + at + ev.action) }] };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [engagements, setEngagements] = useState<Engagement[]>(SEED_ENGAGEMENTS);
  const [userId, setUserId] = useState("u1");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        setEngagements(saved.engagements);
        setUserId(saved.userId);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ engagements, userId })); } catch {}
  }, [engagements, userId]);

  const me = STAFF.find((u) => u.id === userId)!;

  const update = (id: string, fn: (e: Engagement) => Engagement) =>
    setEngagements((all) => all.map((e) => (e.id === id ? fn(e) : e)));

  const transition = (id: string, to: State, action: string) =>
    update(id, (e) => {
      let next: Engagement = { ...e, state: to, enteredAt: nowIso() };
      if (to === "DOCS_REQUESTED" && e.slots.length === 0) next.slots = slotsFor(e.intake);
      if (to === "PREP_READY") next.draftStatus = "drafted";
      if (to === "PREP_SENT") next.draftStatus = "sent";
      const isWebhook = action.startsWith("Simulate");
      next = append(next, {
        actor: isWebhook ? (to === "ACTIVE" ? "DocuSign" : "Calendly") : me.name,
        actorType: isWebhook ? "webhook" : "staff",
        action: action.replace(/^Simulate: /, ""),
        from: e.state,
        to,
      });
      return next;
    });

  const log = (id: string, action: string, actorType: AuditEvent["actorType"] = "staff") =>
    update(id, (e) => {
      const actor = actorType === "staff" ? me.name : actorType === "client" ? e.contact : "System";
      return append(e, { actor, actorType, action });
    });

  const reset = () => {
    setEngagements(SEED_ENGAGEMENTS);
    try { localStorage.removeItem(KEY); } catch {}
  };

  return <Ctx.Provider value={{ engagements, userId, setUserId, transition, log, update, reset }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}
