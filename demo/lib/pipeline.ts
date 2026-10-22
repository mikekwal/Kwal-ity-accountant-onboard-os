// Pipeline states and allowed transitions (see docs/architecture.md section 8).
// Demo only: the real version lives in packages/core and writes to Postgres.

export type State =
  | "BOOKED"
  | "PREP_READY"
  | "PREP_SENT"
  | "MET"
  | "DOCS_REQUESTED"
  | "DOCS_IN_PROGRESS"
  | "DOCS_COMPLETE"
  | "PENDING_APPROVAL"
  | "CHANGE_REVIEW"
  | "LETTER_SENT"
  | "ACTIVE"
  | "CANCELED"
  | "NO_SHOW"
  | "NOT_A_FIT"
  | "LOST";

export const STATE_LABEL: Record<State, string> = {
  BOOKED: "Booked",
  PREP_READY: "Prep ready",
  PREP_SENT: "Prep sent",
  MET: "Met",
  DOCS_REQUESTED: "Docs requested",
  DOCS_IN_PROGRESS: "Docs in progress",
  DOCS_COMPLETE: "Docs complete",
  PENDING_APPROVAL: "Pending approval",
  CHANGE_REVIEW: "Change review",
  LETTER_SENT: "Letter sent",
  ACTIVE: "Active",
  CANCELED: "Canceled",
  NO_SHOW: "No-show",
  NOT_A_FIT: "Not a fit",
  LOST: "Lost",
};

export const TERMINAL: State[] = ["ACTIVE", "CANCELED", "NO_SHOW", "NOT_A_FIT", "LOST"];

// Board columns group related states so the board stays readable.
export const COLUMNS: { key: string; title: string; states: State[]; owner: string }[] = [
  { key: "booked", title: "Booked", states: ["BOOKED"], owner: "Staff" },
  { key: "prep", title: "Meeting prep", states: ["PREP_READY", "PREP_SENT"], owner: "Staff" },
  { key: "met", title: "Met", states: ["MET"], owner: "Staff" },
  { key: "docs", title: "Documents", states: ["DOCS_REQUESTED", "DOCS_IN_PROGRESS", "DOCS_COMPLETE"], owner: "Client" },
  { key: "approval", title: "Approval", states: ["PENDING_APPROVAL", "CHANGE_REVIEW"], owner: "Owner" },
  { key: "letter", title: "Letter sent", states: ["LETTER_SENT"], owner: "Client" },
  { key: "active", title: "Active", states: ["ACTIVE"], owner: "Done" },
];

export type Role = "owner" | "staff";

export type Edge = { to: State; label: string; ownerOnly?: boolean; tone?: "primary" | "neutral" | "danger" };

export const TRANSITIONS: Partial<Record<State, Edge[]>> = {
  BOOKED: [
    { to: "PREP_READY", label: "Generate brief + draft", tone: "primary" },
    { to: "MET", label: "Skip prep, record meeting" },
    { to: "NO_SHOW", label: "Mark no-show", tone: "danger" },
    { to: "CANCELED", label: "Cancel", tone: "danger" },
  ],
  PREP_READY: [
    { to: "PREP_SENT", label: "Mark pre-meeting email sent", tone: "primary" },
    { to: "MET", label: "Record meeting: proceed" },
    { to: "NO_SHOW", label: "Mark no-show", tone: "danger" },
  ],
  PREP_SENT: [
    { to: "MET", label: "Record meeting: proceed", tone: "primary" },
    { to: "NOT_A_FIT", label: "Record meeting: not a fit", tone: "danger" },
    { to: "NO_SHOW", label: "Mark no-show", tone: "danger" },
  ],
  MET: [
    { to: "DOCS_REQUESTED", label: "Kickoff: create checklist + invite", tone: "primary" },
    { to: "LOST", label: "Mark lost", tone: "danger" },
  ],
  DOCS_REQUESTED: [{ to: "LOST", label: "Mark lost", tone: "danger" }],
  DOCS_IN_PROGRESS: [{ to: "LOST", label: "Mark lost", tone: "danger" }],
  DOCS_COMPLETE: [
    { to: "PENDING_APPROVAL", label: "Submit quote for approval", tone: "primary" },
    { to: "LOST", label: "Mark lost", tone: "danger" },
  ],
  PENDING_APPROVAL: [
    { to: "LETTER_SENT", label: "Approve + send engagement letter", ownerOnly: true, tone: "primary" },
    { to: "CHANGE_REVIEW", label: "Request discount / scope change" },
  ],
  CHANGE_REVIEW: [
    { to: "PENDING_APPROVAL", label: "Approve change", ownerOnly: true, tone: "primary" },
    { to: "PENDING_APPROVAL", label: "Reject change", ownerOnly: true },
  ],
  LETTER_SENT: [
    { to: "ACTIVE", label: "Simulate: client signs (DocuSign)", tone: "primary" },
    { to: "CHANGE_REVIEW", label: "Request change (voids letter)" },
  ],
  NO_SHOW: [{ to: "BOOKED", label: "Simulate: client rebooks" }],
};

// Stall thresholds in days (firm config, D10). Demo uses calendar days.
export const STALE_AFTER_DAYS: Partial<Record<State, number>> = {
  PREP_READY: 1,
  PREP_SENT: 1,
  MET: 2,
  DOCS_REQUESTED: 5,
  DOCS_IN_PROGRESS: 7,
  DOCS_COMPLETE: 2,
  PENDING_APPROVAL: 2,
  CHANGE_REVIEW: 2,
  LETTER_SENT: 5,
};
