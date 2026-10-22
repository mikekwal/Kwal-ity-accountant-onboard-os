// Synthetic demo data only. Every name, email and number here is fake.
import { State, STALE_AFTER_DAYS } from "./pipeline";

export const NOW = new Date("2026-10-22T15:00:00Z");
export const FIRM = { name: "Northbridge Tax & Advisory", short: "Northbridge", tz: "America/Chicago" };

export const STAFF = [
  { id: "u1", name: "Dana Whitfield", initials: "DW", role: "owner" as const },
  { id: "u2", name: "Marcus Lee", initials: "ML", role: "staff" as const },
  { id: "u3", name: "Priya Shah", initials: "PS", role: "staff" as const },
];

export type SlotStatus = "missing" | "received" | "waived";
export type Slot = { code: string; label: string; reason: string; required: boolean; status: SlotStatus; file?: string; note?: string };
export type AuditEvent = { at: string; actor: string; actorType: "staff" | "system" | "client" | "webhook"; action: string; from?: State; to?: State; hash: string };
export type Engagement = {
  id: string;
  name: string;
  kind: "Individual" | "Business";
  contact: string;
  email: string;
  phone: string;
  website?: string;
  service: string;
  taxYear: number;
  state: State;
  ownerId: string;
  enteredAt: string;
  meetingAt: string;
  intakeMissing: boolean;
  intake: Record<string, string>;
  slots: Slot[];
  draftStatus: "none" | "drafted" | "sent";
  quote: { label: string; fee: number }[];
  discount: number;
  events: AuditEvent[];
};

// Required-document rules are data, not code (firm config). intake answer -> slot.
export const DOC_RULES: { when: (i: Record<string, string>) => boolean; code: string; label: string; reason: string }[] = [
  { when: (i) => i.entity === "Individual" && i.employed === "Yes", code: "W2", label: "W-2 from each employer", reason: "Intake: employed" },
  { when: (i) => i.entity === "Individual" && i.brokerage === "Yes", code: "1099B", label: "1099-B brokerage statement", reason: "Intake: has brokerage account" },
  { when: (i) => i.entity === "Individual", code: "1099INT", label: "1099-INT / 1099-DIV", reason: "Standard for individual returns" },
  { when: (i) => i.homeowner === "Yes", code: "1098", label: "1098 mortgage interest", reason: "Intake: owns a home" },
  { when: (i) => i.partner === "Yes", code: "K1", label: "Schedule K-1s", reason: "Intake: partner in a business" },
  { when: (i) => i.entity !== "Individual", code: "PL", label: "Year-end P&L and balance sheet", reason: "Business return" },
  { when: (i) => i.entity !== "Individual", code: "BANK", label: "December bank statements", reason: "Business return" },
  { when: (i) => i.payroll === "Yes", code: "941", label: "Payroll reports (Forms 941, W-3)", reason: "Intake: runs payroll" },
  { when: (i) => i.newClient === "Yes", code: "PRIOR", label: "Prior-year tax return", reason: "Intake: new client" },
  { when: (i) => i.entity === "Individual", code: "ID", label: "Photo ID (front and back)", reason: "Identity verification policy" },
];

export function slotsFor(intake: Record<string, string>): Slot[] {
  return DOC_RULES.filter((r) => r.when(intake)).map((r) => ({ code: r.code, label: r.label, reason: r.reason, required: true, status: "missing" }));
}

export function fakeHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

const day = 86400000;
const iso = (d: number) => new Date(NOW.getTime() - d * day).toISOString();

const PATH: State[] = ["BOOKED", "PREP_READY", "PREP_SENT", "MET", "DOCS_REQUESTED", "DOCS_IN_PROGRESS", "DOCS_COMPLETE", "PENDING_APPROVAL", "LETTER_SENT", "ACTIVE"];
const ACTION: Partial<Record<State, [string, AuditEvent["actorType"]]>> = {
  BOOKED: ["Calendly booking received", "webhook"],
  PREP_READY: ["Brief generated, Gmail draft created", "system"],
  PREP_SENT: ["Pre-meeting email sent by staff", "staff"],
  MET: ["Meeting outcome: proceed", "staff"],
  DOCS_REQUESTED: ["Kickoff: checklist created, portal invite sent", "staff"],
  DOCS_IN_PROGRESS: ["First document uploaded", "client"],
  DOCS_COMPLETE: ["All required documents received", "system"],
  PENDING_APPROVAL: ["Quote submitted for approval", "staff"],
  LETTER_SENT: ["Approved, DocuSign envelope sent", "staff"],
  ACTIVE: ["DocuSign: envelope completed", "webhook"],
};

type Seed = {
  name: string; kind: "Individual" | "Business"; contact: string; service: string; state: State; daysInState: number;
  owner: string; intake: Record<string, string>; intakeMissing?: boolean; received?: number; website?: string; meetingIn?: number;
};

const SEEDS: Seed[] = [
  { name: "Jordan & Casey Rivera", kind: "Individual", contact: "Jordan Rivera", service: "1040 Individual", state: "BOOKED", daysInState: 1, owner: "u2", intakeMissing: true, meetingIn: 2, intake: { entity: "Individual", employed: "Yes", brokerage: "Yes", homeowner: "Yes", newClient: "Yes" } },
  { name: "Harbor Lane Dental PLLC", kind: "Business", contact: "Dr. Alicia Moreno", service: "1120-S S-Corp", state: "BOOKED", daysInState: 0, owner: "u3", meetingIn: 3, website: "harborlanedental.example", intake: { entity: "S-Corp", payroll: "Yes", newClient: "Yes" } },
  { name: "Samuel Okafor", kind: "Individual", contact: "Samuel Okafor", service: "1040 Individual", state: "PREP_READY", daysInState: 2, owner: "u2", meetingIn: 0.6, intake: { entity: "Individual", employed: "Yes", partner: "Yes", newClient: "Yes" } },
  { name: "Brightwater Coffee Co.", kind: "Business", contact: "Lena Fischer", service: "1065 Partnership", state: "PREP_SENT", daysInState: 1, owner: "u3", meetingIn: 1, website: "brightwatercoffee.example", intake: { entity: "Partnership", payroll: "Yes", newClient: "Yes" } },
  { name: "Mei-Lin Chen", kind: "Individual", contact: "Mei-Lin Chen", service: "1040 Individual", state: "MET", daysInState: 3, owner: "u2", meetingIn: -3, intake: { entity: "Individual", employed: "Yes", brokerage: "Yes", newClient: "Yes" } },
  { name: "Patel Family", kind: "Individual", contact: "Ravi Patel", service: "1040 Individual", state: "DOCS_REQUESTED", daysInState: 6, owner: "u3", meetingIn: -8, intake: { entity: "Individual", employed: "Yes", homeowner: "Yes", newClient: "Yes" } },
  { name: "Northline Logistics LLC", kind: "Business", contact: "Greg Halvorsen", service: "1120-S S-Corp", state: "DOCS_IN_PROGRESS", daysInState: 2, owner: "u2", received: 3, meetingIn: -10, intake: { entity: "S-Corp", payroll: "Yes", newClient: "Yes" } },
  { name: "Tomás Alvarez", kind: "Individual", contact: "Tomás Alvarez", service: "1040 Individual", state: "DOCS_IN_PROGRESS", daysInState: 9, owner: "u3", received: 2, meetingIn: -14, intake: { entity: "Individual", employed: "Yes", brokerage: "Yes", homeowner: "Yes", newClient: "Yes" } },
  { name: "Greenfield Yoga Studio", kind: "Business", contact: "Hannah Brooks", service: "1065 Partnership", state: "DOCS_COMPLETE", daysInState: 1, owner: "u2", received: 99, meetingIn: -12, intake: { entity: "Partnership", newClient: "Yes" } },
  { name: "Olivia Grant", kind: "Individual", contact: "Olivia Grant", service: "1040 Individual", state: "PENDING_APPROVAL", daysInState: 3, owner: "u1", received: 99, meetingIn: -16, intake: { entity: "Individual", employed: "Yes", newClient: "Yes" } },
  { name: "Summit Roofing Inc.", kind: "Business", contact: "Derek Walsh", service: "1120-S S-Corp", state: "LETTER_SENT", daysInState: 6, owner: "u1", received: 99, meetingIn: -20, intake: { entity: "S-Corp", payroll: "Yes", newClient: "Yes" } },
  { name: "Aisha Rahman", kind: "Individual", contact: "Aisha Rahman", service: "1040 Individual", state: "ACTIVE", daysInState: 2, owner: "u3", received: 99, meetingIn: -22, intake: { entity: "Individual", employed: "Yes", newClient: "Yes" } },
  { name: "Kowalski Bakery", kind: "Business", contact: "Anna Kowalski", service: "1065 Partnership", state: "ACTIVE", daysInState: 5, owner: "u2", received: 99, meetingIn: -30, intake: { entity: "Partnership", payroll: "Yes", newClient: "Yes" } },
];

function build(seed: Seed, idx: number): Engagement {
  const id = `e${100 + idx}`;
  const slug = seed.contact.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
  const reachedIdx = PATH.indexOf(seed.state);
  const steps = PATH.slice(0, reachedIdx + 1);
  const events: AuditEvent[] = [];
  let prev = "genesis";
  steps.forEach((s, i) => {
    const ago = seed.daysInState + (steps.length - 1 - i) * 2 + (i === steps.length - 1 ? 0 : 0.3);
    const [action, actorType] = ACTION[s]!;
    const owner = STAFF.find((u) => u.id === seed.owner)!;
    const actor = actorType === "staff" ? owner.name : actorType === "client" ? seed.contact : actorType === "webhook" ? (s === "BOOKED" ? "Calendly" : "DocuSign") : "System";
    const at = iso(ago);
    const hash = fakeHash(prev + at + action);
    events.push({ at, actor, actorType, action, from: i ? steps[i - 1] : undefined, to: s, hash });
    prev = hash;
  });
  const hasSlots = reachedIdx >= PATH.indexOf("DOCS_REQUESTED");
  const slots = hasSlots ? slotsFor(seed.intake) : [];
  const n = Math.min(seed.received ?? 0, slots.length);
  slots.forEach((s, i) => {
    if (i < n) { s.status = "received"; s.file = `${s.code.toLowerCase()}_2025.pdf`; }
  });
  const isBiz = seed.kind === "Business";
  return {
    id, name: seed.name, kind: seed.kind, contact: seed.contact,
    email: `${slug}@example.com`, phone: `(555) 01${String(10 + idx).padStart(2, "0")}-${String(4000 + idx * 37).slice(0, 4)}`,
    website: seed.website, service: seed.service, taxYear: 2025, state: seed.state, ownerId: seed.owner,
    enteredAt: iso(seed.daysInState), meetingAt: iso(-(seed.meetingIn ?? 0)), intakeMissing: !!seed.intakeMissing,
    intake: seed.intake, slots,
    draftStatus: seed.state === "BOOKED" ? "none" : seed.state === "PREP_READY" ? "drafted" : "sent",
    quote: isBiz
      ? [{ label: `${seed.service} return`, fee: 2400 }, { label: "Payroll filings review", fee: 450 }, { label: "Quarterly estimates (4)", fee: 300 }]
      : [{ label: `${seed.service} return`, fee: 650 }, { label: "State return", fee: 150 }],
    discount: seed.state === "PENDING_APPROVAL" ? 10 : 0,
    events,
  };
}

export const SEED_ENGAGEMENTS: Engagement[] = SEEDS.map(build);

export function staleAt(e: Engagement): Date | null {
  const d = STALE_AFTER_DAYS[e.state];
  if (d === undefined) return null;
  return new Date(new Date(e.enteredAt).getTime() + d * day);
}
export function isStalled(e: Engagement): boolean {
  const s = staleAt(e);
  return !!s && s < NOW;
}
export function daysIn(e: Engagement): number {
  return Math.max(0, Math.round((NOW.getTime() - new Date(e.enteredAt).getTime()) / day));
}

export function briefFor(e: Engagement) {
  const isBiz = e.kind === "Business";
  return {
    who: isBiz
      ? `${e.name} is a ${e.intake.entity} represented by ${e.contact}. ${e.website ? `Their public site (${e.website}) describes a local, owner-operated business.` : "No website was provided."} Runs payroll: ${e.intake.payroll ?? "No"}.`
      : `${e.contact} is a new individual client${e.name.includes("&") ? " filing jointly with a spouse" : ""}. W-2 employee${e.intake.brokerage === "Yes" ? " with a brokerage account" : ""}${e.intake.homeowner === "Yes" ? " and a mortgage" : ""}.`,
    services: isBiz ? ["Business return", "Payroll filings review", "Quarterly estimates", "Possible bookkeeping cleanup"] : ["Federal + state return", e.intake.brokerage === "Yes" ? "Capital gains review" : "Withholding check", "Tax planning for next year"],
    questions: isBiz
      ? ["Who prepared last year's return, and why are you switching?", "Are the books reconciled through December?", "Any owner distributions or loans this year?"]
      : ["Any life changes this year (marriage, home sale, new job)?", "Did you receive any IRS or state notices?", "Do you want to adjust withholding for next year?"],
    flags: e.intakeMissing ? ["Booked without completing the intake form. Confirm details in the meeting."] : isBiz ? ["Switching preparers mid-year: request prior-year workpapers."] : [],
  };
}

export function draftFor(e: Engagement) {
  const owner = STAFF.find((u) => u.id === e.ownerId)!;
  const when = new Date(e.meetingAt).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: FIRM.tz });
  return {
    to: e.email,
    subject: `Looking forward to our call on ${when.split(",")[0]}`,
    body: `Hi ${e.contact.split(" ")[0]},\n\nThanks for booking time with ${FIRM.short}. I'm looking forward to our call on ${when}.\n\nTo make the most of it, it would help to have last year's tax return handy and a rough list of any changes this year${e.kind === "Business" ? " (new hires, equipment purchases, changes in ownership)" : " (new job, home purchase, investments)"}.\n\nTalk soon,\n${owner.name}\n${FIRM.name}`,
  };
}
