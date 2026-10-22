# Architecture

Source: PLAN.md sections 3 to 5, restated for the repo. Decisions referenced as D1 to D11 are in [decisions.md](decisions.md). Known problems with this design, not yet resolved, are in [plan-review.md](plan-review.md); where one affects a section below it is noted inline as **Open:**.

Onboarding OS is single-tenant: one deployment per firm, in that firm's own GCP project, built from the same code and Terraform. Anything that differs between firms (names, branding, fee schedule, document rules, stall thresholds, templates, roles, retention) is firm config, never code.

## 1. Overview

Two front doors, one back office.

- **Staff app** (`apps/staff`): Next.js on Cloud Run, behind Identity-Aware Proxy (IAP). Only the firm's Google Workspace accounts can reach it, with 2-Step Verification enforced in Workspace admin. Hosts the board, client pages, approvals, webhook endpoints (`/api/webhooks/*`) and job handlers (`/api/jobs/*`).
  **Open:** IAP protects a whole service, not a path, so public webhooks and OIDC-authenticated jobs cannot sit on the IAP-protected service as drawn (plan-review item 6).
- **Client portal** (`apps/portal`): separate Next.js service on Cloud Run, public. Upload-only: clients see their own checklist and upload into slots. Clients can never download stored files or see anything outside their engagement.
- **Back office:** Cloud SQL Postgres, encrypted GCS bucket, Cloud Tasks queue, Cloud Scheduler jobs.

## 2. Data flow

```
Calendly ─────────webhook─┐
Intake form ──────webhook─┼─▶ /api/webhooks/*  (public path, signature-verified)
DocuSign Connect ─webhook─┘        │  store raw event (idempotent) → enqueue
                                   ▼
                            Cloud Tasks queue ──▶ /api/jobs/*  (OIDC-authenticated workers)
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

What leaves the firm's GCP project, and to whom:

| Destination | What is sent | What is never sent |
|---|---|---|
| Claude on Vertex AI (in-project, D11) | Redacted intake answers, text of client's public website | Tax documents, SSN/EIN/ITIN, account numbers |
| Gmail (staff mailbox) | Draft emails written by Claude or templates, created in the assigned staff member's drafts | Nothing is sent to a client without a staff click |
| DocuSign | Engagement letter merge fields (names, service lines, fee) | Tax documents |
| Calendly, intake tool | Nothing sent; they send to us | n/a |

## 3. Stack

- TypeScript everywhere, pnpm workspaces.
- Next.js (App Router) for `apps/staff` and `apps/portal`.
- Postgres 16 on Cloud SQL; Drizzle ORM + drizzle-kit migrations; Zod for every external input.
- Cloud Run, Cloud Tasks, Cloud Scheduler, Secret Manager, Cloud KMS, GCS, IAP, Identity Platform (portal auth).
- Terraform for all infrastructure in `infra/`. This is also what makes the product redeployable per firm.
- Vitest (unit and integration), Playwright (e2e smoke).

## 4. Repo layout

```
apps/
  staff/          board, client detail, approvals, /api/webhooks/*, /api/jobs/*
  portal/         client checklist + upload (upload-only)
packages/
  core/           state machine, rules engine, audit, redaction, logger, firm config schema
  db/             drizzle schema, migrations, seed (synthetic data only)
  integrations/   calendly, intake, gmail, docusign, claude, storage
                  each: index.ts (interface), real implementation, fake.ts, fixtures/
infra/            terraform: project, network, sql, kms, buckets, run services, iap, tasks, scheduler
docs/             architecture, security, decisions, runbook
```

## 5. Key mechanics

### Webhook ingest
1. Verify signature first (Calendly webhook signing key, DocuSign Connect HMAC, intake form secret). Reject before parsing anything else.
2. Insert the raw event into `webhook_events`, keyed by provider event ID (unique). A duplicate is a no-op.
3. Enqueue a Cloud Task referencing the stored event.
4. Return 200 quickly. Workers do the real work and are idempotent: replaying an event changes nothing.

**Open:** if step 2 succeeds and step 3 fails, the event is stranded; a reconciliation sweep is needed (plan-review item 18).

### State changes
Only through `transition(engagementId, toState, actor, reason)` in `packages/core`. It checks the allowed-transitions table (section 8 below) and actor permissions, then writes the new state, `state_entered_at`, `stale_at`, and the audit event in **one DB transaction**. Anything not in the table is rejected. No code anywhere else updates `engagements.state`.

### Uploads
1. Portal issues a short-lived signed URL for exactly one slot.
2. File lands in `quarantine/`.
3. Validation worker checks type (PDF, JPG, PNG, HEIC), size, page count, and runs a malware scan (plan: optional; see plan-review item 16).
4. On pass: moved to `clients/{clientId}/{engagementId}/`, slot marked received, audit event written. On fail: stays in quarantine, slot shows rejected, audit event written.

### Claude calls
One module, `packages/integrations/claude`. Every prompt passes through `redact()` (SSN, EIN, ITIN, bank account and routing patterns, with tests). Model ID and region come from config. Every call writes an audit event containing a hash of the prompt, never the prompt text.

### Gmail
Drafts created with `users.drafts.create` in the assigned staff member's mailbox, scope `gmail.compose` only. Auth per D6 (per-user OAuth by default).

### Audit log
- `audit_events` is append-only, enforced in the database: the app role has `INSERT, SELECT` only; a trigger raises on `UPDATE` and `DELETE`.
- Each row stores `prev_hash` and `hash`; `scripts/verify-audit-chain.ts` (`pnpm verify:audit`) recomputes the chain.
- Nightly export to a retention-locked GCS bucket (lock applied only after D8 is confirmed).
- Metadata never contains PII; log IDs and hashes.

**Open:** concurrent appends can fork the chain, and row triggers do not block `TRUNCATE` (plan-review item 7).

## 6. Data model (first pass)

| Table | Purpose |
|---|---|
| `firm_config` | Firm name, branding, stall thresholds, fee schedule, template IDs |
| `staff_users` | Workspace email, role (`owner`, `staff`), active flag |
| `clients` | Person or business; primary contact email and phone; external IDs (Calendly invitee URI) |
| `engagements` | One per client per service per tax year. Holds `state`, `owner_id`, `state_entered_at`, `stale_at`, flags (`intake_missing`) |
| `bookings` | Calendly event and invitee data; status (`scheduled`, `canceled`, `no_show`) |
| `intake_submissions` | Raw answers (JSONB); match status (`matched`, `needs_confirmation`, `unmatched`) |
| `briefs` | Claude-generated pre-meeting brief; model and version; `created_by = system` |
| `email_drafts` | Gmail draft ID, purpose, status (`drafted`, `sent`, `discarded`) |
| `document_requirements` | Expected document slots per engagement (code, label, required, `waived_reason`) |
| `documents` | Uploaded files: slot, GCS path, checksum, size, scan status |
| `quotes` | Service lines, fee, discount |
| `change_requests` | Scope or discount change: type, before/after, `requested_by`, `approved_by`, status |
| `engagement_letters` | DocuSign envelope ID, status, sent and signed timestamps |
| `portal_access` | Hashed one-time tokens, expiry, last used |
| `webhook_events` | Raw inbound events; provider event ID (unique); `processed_at`; error |
| `audit_events` | Append-only: `at`, `actor_type` (`staff`, `system`, `client`, `webhook`), `actor_id`, `engagement_id`, `action`, `from_state`, `to_state`, `metadata` (no PII), `prev_hash`, `hash` |

All timestamps are `timestamptz` in UTC, displayed in the firm's time zone from config.

**Open:** single contact per client, two overlapping portal-auth mechanisms, and the shape of firm config (plan-review items 10, 12, 21).

## 7. Pipeline states

| State | Entered when | Owner | Stale after (default, configurable, D10) |
|---|---|---|---|
| `BOOKED` | Calendly `invitee.created` | Assigned staff | none (flag `intake_missing` shown until matched) |
| `PREP_READY` | Brief + Gmail draft created | Assigned staff | Meeting under 24h away and draft not sent |
| `PREP_SENT` | Staff marks pre-meeting email sent | Assigned staff | Meeting end + 4h with no outcome recorded |
| `MET` | Staff records outcome = proceed | Assigned staff | 2 business days without kickoff |
| `DOCS_REQUESTED` | Kickoff: slots created, organizer + portal invite sent | Client | 5 days with no uploads |
| `DOCS_IN_PROGRESS` | First upload | Client | 7 days since last upload |
| `DOCS_COMPLETE` | All required slots received or waived (with reason) | Reviewer | 2 business days |
| `PENDING_APPROVAL` | Staff submits for approval with quote | Owner | 2 business days |
| `CHANGE_REVIEW` | Scope or discount change requested | Owner | 2 business days |
| `LETTER_SENT` | Approval, DocuSign envelope sent | Client | 5 days unsigned |
| `ACTIVE` | DocuSign Connect reports completed | none | Terminal (onboarding done) |
| `CANCELED` | Calendly `invitee.canceled` or staff action | none | Terminal |
| `NO_SHOW` | Calendly `invitee_no_show.created` or staff action | none | Terminal; can re-enter `BOOKED` on rebook |
| `NOT_A_FIT` | Staff action | none | Terminal |
| `LOST` | Staff action | none | Terminal |

**Stall sweep:** daily via Cloud Scheduler, plus on page load. Any engagement past `stale_at` gets a Stalled badge, moves to the top of its owner's queue, and appears in a morning digest to the owner and the firm owner. Nudge emails to clients are drafted, never sent automatically. Internal staff digests may send automatically.

## 8. Allowed transitions (draft, derived from PLAN.md)

PLAN.md describes states but not a full transition table. This is the table implied by sections 5 and 6, to be implemented in Phase 1 once confirmed. Gaps are flagged in plan-review items 5, 8, 9.

| From | To | Trigger | Actor |
|---|---|---|---|
| (new) | `BOOKED` | Calendly `invitee.created`, or manual create | webhook, staff |
| `BOOKED` | `PREP_READY` | Brief and draft created | system |
| `PREP_READY` | `PREP_SENT` | Staff marks pre-meeting email sent | staff |
| `PREP_SENT` | `MET` | Outcome = proceed | staff |
| `MET` | `DOCS_REQUESTED` | Kickoff button | staff |
| `DOCS_REQUESTED` | `DOCS_IN_PROGRESS` | First upload | client (via system) |
| `DOCS_IN_PROGRESS` | `DOCS_COMPLETE` | All required slots received or waived | system |
| `DOCS_COMPLETE` | `PENDING_APPROVAL` | Submit for approval with quote | staff |
| `PENDING_APPROVAL` | `LETTER_SENT` | Owner approves, envelope sent | owner |
| `PENDING_APPROVAL` | `CHANGE_REVIEW` | Scope or discount change requested | staff, owner |
| `LETTER_SENT` | `CHANGE_REVIEW` | Change after approval (forces re-approval) | staff, owner |
| `CHANGE_REVIEW` | `PENDING_APPROVAL` | Change decided, re-approval needed | owner |
| `CHANGE_REVIEW` | `LETTER_SENT` | Change approved, new envelope sent | owner |
| `LETTER_SENT` | `ACTIVE` | DocuSign Connect: completed | webhook |
| `LETTER_SENT` | `PENDING_APPROVAL` | DocuSign Connect: declined or voided | webhook |
| `BOOKED`, `PREP_READY`, `PREP_SENT` | `CANCELED` | Calendly `invitee.canceled` | webhook, staff |
| `BOOKED`, `PREP_READY`, `PREP_SENT` | `NO_SHOW` | Calendly `invitee_no_show.created` | webhook, staff |
| `NO_SHOW` | `BOOKED` | Rebooking by same email | webhook |
| any non-terminal | `NOT_A_FIT`, `LOST` | Staff action with reason | staff |

## 9. Environments

| Env | Where | Data | Integrations |
|---|---|---|---|
| dev | Local Postgres (Docker) | Synthetic seed only | Fakes from `packages/integrations/*/fake.ts` |
| staging | Separate GCP project | Synthetic only | Test Calendly account, DocuSign developer sandbox, test Workspace user, Claude on Vertex |
| prod | Separate GCP project per firm | Real client data exists only here | Real |

Recorded webhook fixtures live in `packages/integrations/*/fixtures/` for replay tests.

## 10. What is firm config (product rule)

| Area | Examples |
|---|---|
| Identity | Firm name, branding, portal domain, time zone, holidays |
| Pipeline | Stall thresholds (D10), roles and capabilities (D7) |
| Money | Fee schedule, discount rules |
| Documents | Required-document rules (intake answers to slots), organizer mode (D2) |
| Messaging | Email templates (pre-meeting, portal invite, nudges, digest) |
| Integrations | Intake source (D1), e-sign templates (D4), mail auth mode (D6), AI model and region (D11) |
| Retention | Document, prospect and audit retention (D8) |

Secrets (API keys, signing keys, OAuth clients) are never config; they live in Secret Manager.
