# CPA Client Onboarding Platform — Implementation Plan

Working name: **Onboarding OS**. Built single-tenant (one deployment per firm) so it can be redeployed for other firms later.

---

## 0. The problem in one paragraph

A US CPA firm onboards ~5 new clients a week. Today the process lives in five places (Calendly, an optional intake form, an Excel tracker, Dropbox, manual email). Staff spend more time moving information between those systems than doing client work. Two specific leaks: **prospects who book without filling out the intake form**, and **clients who stall mid-onboarding without anyone noticing.** The firm handles tax documents, so the FTC Safeguards Rule (16 CFR 314) and IRS Pub 4557 apply.

## 1. Design principles (Claude Code: treat these as rules)

1. **One record, one state.** Every engagement has exactly one pipeline state at a time. The board is the source of truth; nothing lives in a side spreadsheet.
2. **Nothing reaches a client without a human trigger.** AI drafts; a person sends. Human-clicked sends are fine and are logged.
3. **Every automated action and every human approval is written to an append-only audit log.**
4. **Rules where possible, AI where it helps.** The required-documents list comes from deterministic rules, not from the model. Claude writes briefs and drafts.
5. **Stalls are a state, not an accident.** Every state has an owner and a "stale after" timer. A daily sweep surfaces anything that has sat too long.
6. **Least data out.** Tax documents never go to the model in v1. Prompts are built from intake answers and public info, with identifiers redacted.

## 2. Scope decisions — keep, simplify, defer, add

| Requested | Call | Reasoning |
|---|---|---|
| Calendly webhook creates client record | **Keep** | Core trigger. Needs Calendly Standard plan or higher for webhooks. |
| Match optional intake form by email; flag "booked, no intake" | **Keep** | Core leak #1. Add fallback: name + phone match, flagged for human confirmation. |
| Research brief + draft pre-meeting email in Gmail | **Keep, simplify** | Brief from intake answers + client's public website only. Draft lands in the staff member's Gmail drafts; they edit and send from Gmail. |
| One button after meeting: create doc folder + send tax organizer | **Keep** | Organizer content driven by rules from intake answers (see D2). |
| App checks documents against expected list | **Simplify** | Instead of AI classifying random uploads, the portal shows **one upload slot per expected document**. The checklist *is* the upload form, so gaps are visible instantly. No classification needed in v1. |
| Google Document AI | **Defer** | Not needed once uploads go into labelled slots. Revisit for OCR/validation in v2. |
| Dropbox | **Replace (recommended)** | Store in an encrypted GCS bucket behind the client portal. One fewer vendor to oversee in the security plan. Decision D3. |
| Excel tracker | **Replace** | The pipeline board replaces it. One-time import of open clients at launch. |
| DocuSign engagement letter on approval | **Keep** | eSignature API + DocuSign Connect webhook to mark signed. |
| Discounts and scope changes as real pipeline states | **Keep** | Modeled as change requests that hold the engagement in a review state until approved. |
| SSO + MFA via Google Workspace | **Keep** | Identity-Aware Proxy (IAP) in front of the staff app; 2-Step Verification enforced in Workspace admin. |
| Encryption at rest and in transit | **Keep** | Default GCP encryption + customer-managed keys (Cloud KMS) on Cloud SQL and GCS. TLS everywhere. |
| Append-only audit log | **Keep** | DB-enforced append-only table with hash chain, nightly export to a retention-locked bucket. |
| Architecture write-up for their WISP | **Keep** | Phase 7 deliverable. |
| Claude API | **Keep, via Vertex AI (recommended)** | Claude on Vertex AI in a US regional endpoint keeps processing inside their own GCP project and Google agreement. Decision D11. |
| *(not listed)* Stall detection + daily digest | **Add** | This is the actual fix for leak #2. |
| *(not listed)* Cancel / no-show handling | **Add** | Calendly sends `invitee.canceled` and `invitee_no_show.created`; without these, dead records clutter the board. |

## 3. Architecture

Two front doors, one back office:

- **Staff app** — Next.js on Cloud Run, behind IAP. Only the firm's Workspace accounts can reach it.
- **Client portal** — separate Next.js service on Cloud Run, public. Upload-only: clients see their checklist and upload into slots. **Clients can never download files back out.**
- **Back office** — Postgres, encrypted bucket, queue, scheduled jobs.

```
Calendly ─────────webhook─┐
Intake form ──────webhook─┼─▶ /api/webhooks/* (staff svc, public path, signature-verified)
DocuSign Connect ─webhook─┘        │  store raw event (idempotent) → enqueue
                                   ▼
                            Cloud Tasks queue ──▶ /api/jobs/* (OIDC-authenticated workers)
                                   │
         ┌─────────────────────────┼──────────────────────────────┐
         ▼                         ▼                              ▼
  Claude on Vertex AI      Gmail API (drafts/sends        DocuSign eSignature API
  (briefs, drafts)         as staff, gmail.compose)       (engagement letters)
                                   │
                                   ▼
                 Cloud SQL Postgres (private IP, CMEK) ◀── staff app (IAP + Workspace 2SV)
                                   ▲
Clients ─(link + 2nd factor)─▶ portal svc ──signed upload URLs──▶ GCS bucket (CMEK, versioned)
                                                                    quarantine/ → clients/
Cloud Scheduler ──daily──▶ stall sweep + digest
Every write ──▶ audit_events (append-only) ──nightly──▶ retention-locked GCS bucket
```

### Stack
- TypeScript everywhere, pnpm workspaces
- Next.js (App Router) for `apps/staff` and `apps/portal`
- Postgres 16 on Cloud SQL, Drizzle ORM + drizzle-kit migrations, Zod for all input validation
- Cloud Run, Cloud Tasks, Cloud Scheduler, Secret Manager, Cloud KMS, GCS, Identity-Aware Proxy, Identity Platform (portal auth)
- Terraform for all infrastructure (`infra/`) — also what makes this redeployable for the next firm
- Vitest (unit/integration), Playwright (e2e smoke)

### Repo layout
```
apps/
  staff/        # board, client detail, approvals, webhooks, job handlers
  portal/       # client checklist + upload
packages/
  core/         # domain: state machine, rules engine, audit, redaction
  db/           # drizzle schema, migrations, seed (synthetic data only)
  integrations/ # calendly, intake-form, gmail, docusign, claude, gcs — each behind an interface with a fake
infra/          # terraform: project, network, sql, kms, buckets, run services, iap, tasks, scheduler
docs/           # architecture.md, security.md, decisions.md, runbook.md
```

### Key mechanics
- **Webhook ingest:** verify signature (Calendly signing key, DocuSign Connect HMAC, intake form secret) → insert into `webhook_events` keyed by provider event ID (duplicates are no-ops) → enqueue a Cloud Task → return 200 fast. Workers do the real work and can retry safely.
- **State changes:** only through `transition(engagementId, toState, actor, reason)` in `packages/core`. It checks the allowed-transitions table, writes the new state and the audit event in **one DB transaction**, and rejects anything else.
- **Uploads:** portal issues a short-lived signed URL for one slot → file lands in `quarantine/` → worker checks type (PDF/JPG/PNG/HEIC), size, page count, optional malware scan → moves to `clients/{clientId}/{engagementId}/` and marks the slot received.
- **Claude calls:** one module, `integrations/claude`. Every prompt passes through `redact()` first (SSN/EIN/account-number patterns, with tests). Model ID and region come from config, not code. Every call is audit-logged with a hash of the prompt, not the prompt text.
- **Gmail:** create drafts with `users.drafts.create` in the assigned staff member's mailbox. Scope limited to `gmail.compose`. Auth method is decision D6.

## 4. Data model (first pass — confirm in discovery)

| Table | Purpose |
|---|---|
| `firm_config` | Firm name, branding, stall thresholds, fee schedule, template IDs |
| `staff_users` | Workspace email, role (`owner`, `staff`), active flag |
| `clients` | Person or business; primary contact email/phone; external IDs (Calendly invitee URI) |
| `engagements` | One per client per service/tax year. Holds `state`, `owner_id`, `state_entered_at`, `stale_at`, flags (`intake_missing`) |
| `bookings` | Calendly event + invitee data, status (scheduled/canceled/no-show) |
| `intake_submissions` | Raw answers (JSONB), match status (`matched`, `needs_confirmation`, `unmatched`) |
| `briefs` | Claude-generated pre-meeting brief, model/version, created_by=system |
| `email_drafts` | Gmail draft ID, purpose, status (`drafted`, `sent`, `discarded`) |
| `document_requirements` | Expected doc slots per engagement (code, label, required, `waived_reason`) |
| `documents` | Uploaded files: slot, GCS path, checksum, size, scan status |
| `quotes` | Service lines, fee, discount |
| `change_requests` | Scope or discount change: type, before/after, requested_by, approved_by, status |
| `engagement_letters` | DocuSign envelope ID, status, sent/signed timestamps |
| `portal_access` | Hashed one-time tokens, expiry, last used |
| `webhook_events` | Raw inbound events, provider event ID (unique), processed_at, error |
| `audit_events` | Append-only: `at`, `actor_type` (staff/system/client/webhook), `actor_id`, `engagement_id`, `action`, `from_state`, `to_state`, `metadata` (no PII), `prev_hash`, `hash` |

Audit enforcement: app DB role has `INSERT, SELECT` only on `audit_events`; a trigger raises on `UPDATE`/`DELETE`; `scripts/verify-audit-chain.ts` recomputes the hash chain.

## 5. Pipeline states

| State | Entered when | Owner | Stale after (default, configurable) |
|---|---|---|---|
| `BOOKED` | Calendly `invitee.created` | Assigned staff | — (flag `intake_missing` shown until matched) |
| `PREP_READY` | Brief + Gmail draft created | Assigned staff | Meeting is < 24h away and draft not sent |
| `PREP_SENT` | Staff marks pre-meeting email sent (or Gmail shows draft sent) | Assigned staff | Meeting end + 4h with no outcome recorded |
| `MET` | Staff records outcome = proceed | Assigned staff | 2 business days without kickoff |
| `DOCS_REQUESTED` | Kickoff button: slots created, organizer + portal invite sent | Client | 5 days with no uploads |
| `DOCS_IN_PROGRESS` | First upload | Client | 7 days since last upload |
| `DOCS_COMPLETE` | All required slots received or waived (with reason) | Reviewer | 2 business days |
| `PENDING_APPROVAL` | Staff submits for approval with quote | Owner | 2 business days |
| `CHANGE_REVIEW` | Scope or discount change requested (returns to `PENDING_APPROVAL` or `LETTER_SENT` path on decision) | Owner | 2 business days |
| `LETTER_SENT` | Approval → DocuSign envelope sent | Client | 5 days unsigned |
| `ACTIVE` | DocuSign Connect reports completed | — | Terminal (onboarding done) |
| `CANCELED` / `NO_SHOW` / `NOT_A_FIT` / `LOST` | Calendly events or staff action | — | Terminal; `NO_SHOW` can re-enter `BOOKED` on rebook |

Stall sweep (daily, plus on page load): any engagement past `stale_at` gets a **Stalled** badge, moves to the top of the owner's queue, and appears in a morning digest to the owner and firm owner. Nudge emails to clients are **drafted**, not sent.

---

## 6. Phases

Each phase ends at a **gate**: Claude Code stops, summarizes what was built, lists anything it couldn't verify, and waits for approval before starting the next phase.

### Phase 0 — Paid discovery (what the client asked for)
**Goal:** agree on the process, data model, and decisions before much code.
- Map the current process end to end (from Calendly booking to signed letter), including every handoff and who does it.
- Resolve decisions D1–D11 below; record each in `docs/decisions.md`.
- Confirm the data model (section 4) and pipeline states (section 5).
- Draft `docs/architecture.md` and the outline of `docs/security.md`.
- Produce the phased estimate.

**Deliverables:** process map, decisions log, data model, architecture doc, phased plan + price.
**Gate:** client signs off on scope and decisions.

### Phase 1 — Foundation
- Monorepo scaffold, lint, typecheck, test, CI (GitHub Actions → Cloud Build or Cloud Deploy).
- Terraform: project, VPC, Cloud SQL (private IP, CMEK, automated backups, PITR), KMS keyring, buckets (CMEK, versioning, uniform access, public access prevention), Secret Manager, Artifact Registry, two Cloud Run services, Cloud Tasks queue, Scheduler, IAP on staff service.
- Staff auth: verify the IAP JWT on every request, map to `staff_users`, deny unknown users.
- DB schema + migrations for all section-4 tables; audit table hardening (role grants, trigger, hash chain).
- `transition()` state machine with full allowed-transitions table and tests.
- Board UI: columns by state, client detail page with timeline from `audit_events`, manual "create engagement".
- Seed script with synthetic clients only.

**Acceptance:** a staff user signs in with Workspace (2SV enforced), creates a client manually, moves it through states, and every move appears in the timeline. An unknown Google account is rejected. `UPDATE audit_events` fails at the DB. `verify-audit-chain` passes.

### Phase 2 — Calendly + intake matching
- Calendly webhook subscription (organization scope) for `invitee.created`, `invitee.canceled`, `invitee_no_show.created`; signature verification; idempotent ingest.
- Fetch full invitee details via the invitee URI in the payload.
- Intake form webhook (tool per D1); match by email → fallback name+phone (needs confirmation) → unmatched.
- `intake_missing` flag on `BOOKED` cards; clears automatically when a matching intake arrives.
- Cancel → `CANCELED`; no-show → `NO_SHOW`; rebooking by same email reopens.

**Acceptance:** replaying recorded fixtures twice produces exactly one client and one booking. A booking with no intake shows the flag; posting the intake clears it. A mismatched email lands in a "confirm match" queue, never auto-merged.

### Phase 3 — Pre-meeting prep (Claude + Gmail)
- `redact()` with unit tests covering SSN, EIN, ITIN, bank/routing patterns.
- Brief generator: inputs = intake answers + text of the client's public website (if provided). Output = structured brief (who they are, likely services, questions to ask, red flags). Stored in `briefs`, shown on client page, editable.
- Pre-meeting email draft created in the assigned staff member's Gmail drafts, linked from the card.
- Engagement moves to `PREP_READY`; staff clicks "Sent" (or the app detects the draft was sent) → `PREP_SENT`.

**Acceptance:** with fakes, a booked client gets a brief and a draft within one minute. No email is sent by the system. Redaction tests pass. Prompt text is never logged.

### Phase 4 — Kickoff, client portal, document checklist
- Rules engine (`packages/core/rules`): intake answers → required document slots (e.g. W-2 if employed, 1099-B if brokerage, K-1 if partner, prior-year return if new client). Rules are data (JSON/TS config) the firm can edit.
- Kickoff button on `MET`: creates slots, generates/attaches the organizer (per D2), creates portal access, sends invite **when staff clicks send**.
- Portal: sign-in (link + second factor per D5), checklist with slot status, upload per slot, "I don't have this" with a note. No download, no browsing other clients.
- Upload pipeline: signed URL → quarantine → validation worker → `clients/` path → slot marked received.
- Staff view: missing list, received files (staff can view/download), waive slot with reason, request re-upload.
- Auto state moves: first upload → `DOCS_IN_PROGRESS`; all required received/waived → `DOCS_COMPLETE`.

**Acceptance:** a test client uploads 3 of 4 required docs → staff sees exactly the missing one. Portal token is single-use and expires. A file outside allowed types is rejected and never leaves quarantine. A client cannot reach another client's slots (tested).

### Phase 5 — Approval, pricing states, DocuSign
- Quote builder from `firm_config` fee schedule; discounts and scope changes create `change_requests` → `CHANGE_REVIEW`.
- Owner approves → DocuSign envelope from template with merge fields → `LETTER_SENT`.
- DocuSign Connect webhook (HMAC verified) → `ACTIVE` on completed; declined/voided → back to `PENDING_APPROVAL` with reason.

**Acceptance:** in the DocuSign developer sandbox, approve → envelope sent → sign → engagement shows `ACTIVE` with the full trail in the audit timeline. A discount added after approval forces re-approval before a new letter can be sent.

### Phase 6 — Stall sweep, digest, dashboard
- Cloud Scheduler job computes stale engagements, sets badges, writes audit events.
- Morning digest to each owner (sent to staff only — internal, so automatic is fine) listing stalled items with links.
- Client nudge drafts for stalled `DOCS_*` and `LETTER_SENT` states, created in Gmail drafts.
- Dashboard: count by state, median days per state, stalled count, booked-without-intake rate.

**Acceptance:** moving a fixture's clock forward past each threshold produces the right badge, digest line, and draft — and no client email is sent.

### Phase 7 — Hardening, security write-up, launch
- Security pass: dependency audit, headers/CSP, rate limits on portal and webhooks, least-privilege service accounts, no PII in logs (log scrubber + test).
- Backups: run and document a real point-in-time restore to a scratch instance.
- Audit export: nightly export to retention-locked bucket; verify chain in CI against a snapshot.
- `docs/security.md` — the architecture write-up for their WISP (outline below).
- `docs/runbook.md` — rotating secrets, offboarding a staff user, handling a suspected breach (FTC notification within 30 days for qualifying events), restoring from backup.
- Import open clients from the Excel tracker (CSV → mapped states, reviewed by staff before go-live).
- Staff training session; two-week parallel run alongside the old process.

**Acceptance:** restore test documented with timestamps; security.md reviewed by the firm's Qualified Individual; all open clients imported and confirmed.

---

## 7. Decisions to resolve in discovery

| # | Question | Recommendation |
|---|---|---|
| D1 | Which tool is the intake form, and can it send a webhook? | If it's a Calendly booking question set, fold it in. Otherwise Typeform/Jotform/Google Form via webhook or Apps Script. |
| D2 | Where does the tax organizer come from? Their tax software (UltraTax, Lacerte, Drake, CCH) or the app? | v1: attach the organizer their software produces; the portal checklist does the tracking. |
| D3 | Document storage: GCS, keep Dropbox, or Google Drive? | GCS behind the portal — encryption keys, access and logs all in one place. |
| D4 | DocuSign plan includes API access? Which templates? | Confirm plan; build in the developer sandbox first. |
| D5 | Second factor for the client portal | Identity Platform: email link + SMS or authenticator code. Confirm with their Qualified Individual. |
| D6 | Gmail access: per-user OAuth or domain-wide delegation? | Per-user OAuth (narrower). DWD only if they prefer zero setup per staff member, scoped to `gmail.compose`. |
| D7 | Roles: who can approve, who can waive documents, who sees fees? | `owner` approves and changes pricing; `staff` does everything else. |
| D8 | Retention periods for documents and audit logs | Firm's call; build retention as config. |
| D9 | Approximate number of consumers whose data they hold (5,000 threshold under 314.6) | Determines which Safeguards elements are formally required; build as if all apply. |
| D10 | Stall thresholds per state | Start with section 5 defaults. |
| D11 | Claude via Vertex AI (US regional endpoint) or direct API with a zero-data-retention agreement | Vertex AI — stays inside their GCP project and existing Google agreement. |

## 8. Environments and test data
- **dev:** local Postgres, all integrations replaced by fakes in `packages/integrations/*/fake.ts`. Synthetic data only.
- **staging:** separate GCP project; test Calendly account, DocuSign developer sandbox, test Workspace user, Claude on Vertex. Synthetic data only.
- **prod:** separate GCP project. Real client data exists only here.
- Recorded webhook fixtures in `packages/integrations/*/fixtures/` for replay tests.

## 9. Security write-up outline (`docs/security.md`)
1. System overview and data flow diagram
2. Data inventory: what customer information is stored, where, and for how long
3. Access control: Workspace SSO via IAP, 2SV enforcement, roles, client portal auth, offboarding
4. Encryption: at rest (CMEK via Cloud KMS, key rotation), in transit (TLS), key access
5. Logging and monitoring: append-only audit log, hash chain, Cloud Logging, alerting
6. AI usage: what is sent to Claude, redaction, region, what is never sent
7. Vendors/service providers: Google Cloud, Calendly, DocuSign, intake form tool — what each receives
8. Backups and recovery: schedule, PITR, tested restore
9. Change management: CI, code review, infra as code
10. Incident response hooks: detection, contacts, FTC notification path
11. Mapping table: each control → Safeguards Rule 314.4 element it supports

## 10. Rough effort (one developer with Claude Code)

| Phase | Estimate |
|---|---|
| 0 Discovery | 1–2 weeks (mostly calls and docs) |
| 1 Foundation | 1–1.5 weeks |
| 2 Calendly + intake | 3–5 days |
| 3 Prep (Claude + Gmail) | 3–5 days |
| 4 Kickoff + portal + checklist | 1.5–2 weeks |
| 5 Approval + DocuSign | 1 week |
| 6 Stall sweep + dashboard | 3–5 days |
| 7 Hardening + launch | 1–1.5 weeks |
| **Total** | **~7–10 weeks** |

Estimates assume D1–D11 are settled in Phase 0 and integration accounts (Calendly paid plan, DocuSign API access, GCP billing, Workspace admin) are provided promptly.
