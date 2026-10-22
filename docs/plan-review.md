# PLAN.md review

Written 2026-10-22, before any code. Nothing in PLAN.md has been changed; this is the list of what I think is wrong, risky, missing, or over-built. Items are numbered so other docs can point at them.

Severity: **High** = changes the product or the Phase 1 foundation; decide before Phase 1. **Medium** = fix in the phase it affects. **Low** = worth knowing.

## Product-level

### 1. High: the product only works for firms on Google Workspace
Staff auth is IAP + Workspace 2SV, mail is the Gmail API. A firm on Microsoft 365 (common among small CPA firms) cannot use it at all. For a one-firm build that is fine; for a product it is a market decision.
**Fix:** decide now. Either state "Google Workspace firms only" in positioning, or name the mail interface `mail` (Gmail + Microsoft Graph adapters) and plan staff auth that is not tied to Workspace (IAP with external identities via Identity Platform, using Microsoft as an OIDC provider). This affects Phase 1 auth design.

### 2. High: nobody owns the running system
"One deployment per firm in their GCP project" assumes the firm can own a GCP project, billing, Terraform state, patching and incident response. A 5-client-a-week firm has no one who can. If you operate it, you become a service provider under the Safeguards Rule (314.4(f): the firm must select and oversee you), you need your own security program, and you are patching and migrating N separate deployments.
**Fix:** add a decision: who hosts and operates (firm-owned project you administer, or your own org with one project per firm). Design the fleet story early: one Terraform module, per-firm tfvars and state, one release pipeline that migrates every firm. Also price the fixed monthly floor per firm (private-IP Cloud SQL, KMS keys, load balancer, IAP, Identity Platform SMS) before quoting anyone.

### 3. High: tax documents are collected before an engagement letter exists
The pipeline goes docs first (`DOCS_*`), then quote, approval and letter. Common practice is letter first, then documents, because the letter defines scope and responsibility before the firm takes custody of taxpayer data. Some firms do want to see a prior-year return before quoting.
**Fix:** make this a discovery decision. My default would be: letter before documents, with an optional "prior-year return" slot allowed before the quote. This reorders the state machine, so settle it before Phase 1 builds the transitions table.

### 4. High: overlap with tools firms already pay for
TaxDome, Canopy, Karbon, Financial Cents, SmartVault, and the portals built into UltraTax/CCH/Drake already do some mix of pipeline, client portal, organizers and e-sign. A firm adopting this likely already has one, so their clients would get a second portal. The plan also never says how documents get from GCS into the firm's tax software or document system after collection.
**Fix:** decide what Onboarding OS is: the system of record for onboarding documents, or the front end that hands off to the firm's existing portal/DMS. Either way, add a hand-off path (bulk export per engagement, or push to the firm's DMS) to scope.

## Process and state model

### 5. High: Calendly reschedules will be processed as cancellations
A Calendly reschedule arrives as `invitee.canceled` (with `rescheduled: true`) plus a new `invitee.created` (with `old_invitee`). Mapping cancel straight to `CANCELED` kills the engagement and creates a duplicate. Also unhandled: `invitee_no_show.deleted` (staff un-marks a no-show). And the plan contradicts itself: Phase 2 says "rebooking by same email reopens", but the state table only lets `NO_SHOW` re-enter `BOOKED`, not `CANCELED`.
**Fix:** treat reschedule as a booking update on the same engagement; handle no-show deletion; decide whether `CANCELED` can reopen on rebook.

### 8. Medium: `CHANGE_REVIEW` as a pipeline state loses where the engagement was
If a scope change comes in while documents are being collected, moving to `CHANGE_REVIEW` loses the docs state. The return path is ambiguous ("returns to `PENDING_APPROVAL` or `LETTER_SENT` path"). A discount after the letter is sent also needs the existing envelope voided, which is not mentioned.
**Fix:** model an open change request as an overlay that blocks the approve and send transitions, not as a state. Or, at minimum, store the state to return to. Decide before Phase 1 writes the transitions table.

### 9. Medium: the pipeline has no skip edges
Real cases the linear path does not allow: same-day meeting with no prep, Claude fails, staff never send the prep email (`BOOKED` or `PREP_READY` straight to `MET`); every slot waived (`DOCS_REQUESTED` to `DOCS_COMPLETE`); importing open clients mid-pipeline (Phase 7). If staff cannot move a card where it belongs, the side spreadsheet comes back.
**Fix:** add the skip edges, each requiring a reason, and an import path that creates engagements in any non-terminal state with an audit event.

### 10. Medium: one contact per client
Married-filing-jointly clients are two people who both sign the engagement letter and may both upload. Businesses have several owners and often a bookkeeper. `clients` holds a single primary contact; DocuSign and portal access assume one person.
**Fix:** add `contacts` (a client has many) and engagement participants with roles (signer, uploader). This is a Phase 1 schema change.

### 11. Medium: returning clients are out of scope
For most CPA firms the big onboarding wave is existing clients every January, not new prospects. The data model already allows one engagement per tax year, so this is cheap to support, but nothing in the plan creates next year's engagement without a Calendly booking.
**Fix:** decide whether "roll over to next tax year" is in v1. At minimum, manual create should support it.

### 19. Medium: the stall badge is written on page load
"Stall sweep (daily, plus on page load)" implies writes (and audit events) on reads.
**Fix:** "stalled" is derived at read time (`now() > stale_at`); only the scheduled sweep writes audit events and the digest. Business-day math needs the firm's time zone and a holiday list; tax-season thresholds may differ (both now in D10 config shape).

## Security and infrastructure

### 6. High: webhooks and jobs cannot share the IAP-protected staff service as drawn
IAP applies to a whole backend service (or a whole Cloud Run service with direct IAP), not a URL path. Public webhooks and Cloud Tasks/Scheduler OIDC calls to `/api/webhooks/*` and `/api/jobs/*` on the staff service either get blocked by IAP or need a load balancer with path-split backends, which is easy to misconfigure into exposing the staff app.
**Fix:** a third Cloud Run service, `apps/worker` (or `ingest`): public signature-verified webhook routes plus job routes invoked by Cloud Tasks and Scheduler using OIDC and Cloud Run IAM. The staff service stays 100% behind IAP. This changes Phase 1 Terraform and the repo layout.

### 7. High: the audit hash chain can fork, and `TRUNCATE` is not blocked
- Two concurrent transactions read the same `prev_hash` and both append, so the chain forks and `verify-audit-chain` fails (or worse, a verifier that picks one branch misses the other).
- Row-level `UPDATE`/`DELETE` triggers do not fire on `TRUNCATE`.
- A role that owns the table can `ALTER TABLE ... DISABLE TRIGGER`.
- A foreign key from `audit_events` with cascade would delete audit rows when retention deletes a client.
**Fix (implementation detail, not a plan change):** serialize appends with `pg_advisory_xact_lock` inside the transaction; add a `BEFORE TRUNCATE` statement trigger and revoke `TRUNCATE`; the app role must not own the table; no cascading FKs into `audit_events`. I will do this in Phase 1 regardless.

### 12. Medium: two overlapping portal auth mechanisms
D5 uses Identity Platform (email link + second factor), and the data model also has `portal_access` with custom hashed one-time tokens. Phase 4 says the portal token is single-use, but clients come back over days to upload, so they need to sign in repeatedly.
**Fix:** Identity Platform handles authentication; `portal_access` becomes the invite record that binds a person to an engagement (single-use invite, then normal sign-in with MFA).

### 13. Medium: "the app detects the draft was sent" is not reliable with `gmail.compose`
A missing draft means sent or deleted; telling them apart needs a wider scope (`gmail.metadata` or `gmail.readonly`).
**Fix:** v1 uses the staff "Sent" click only. Revisit if staff forget to click.

### 14. Medium: per-user OAuth refresh tokens have no home
"Secrets live only in Secret Manager" does not fit N per-user refresh tokens.
**Fix:** decide in Phase 3: encrypted DB column with KMS envelope encryption (my preference), or one Secret Manager secret per staff user.

### 15. Medium: fetching the client's website is an SSRF and prompt-injection surface
The brief generator fetches a URL the prospect typed in.
**Fix:** fetch from a path with no access to the VPC or metadata server, enforce size and time limits, strip to text, and treat the content as untrusted input to the prompt. The human-send rule already stops injected content from reaching a client automatically.

### 16. Medium: malware scanning is "optional"
Staff open these files on their own machines.
**Fix:** make scanning required (ClamAV on Cloud Run is the standard GCP pattern), or have the Qualified Individual accept the risk in writing. Also: signed upload URLs must bind content type and size (`x-goog-content-length-range`), and clients need a way to replace a wrong upload before staff review it (missing today).

### 17. Medium: IRC section 7216 is not mentioned
Section 7216 limits how tax preparers use and disclose tax return information. Sending intake data to Vertex for brief writing is probably fine as an auxiliary service for return preparation, but some uses need the taxpayer's written consent. Not my call or yours; the firm (or their counsel) should confirm. The runbook also needs state breach-notification laws alongside the FTC 30-day notice.
**Fix:** add to Phase 0 questions; possibly a consent checkbox on the intake.

### 18. Medium: stranded webhook events
If the `webhook_events` insert succeeds and the Cloud Tasks enqueue fails, nothing processes the event.
**Fix:** a reconciliation sweep that re-enqueues events with `processed_at IS NULL` older than a few minutes (or a transactional outbox). Cheap; Phase 2.

### 20. Medium: locking the audit bucket's retention policy is irreversible
A locked GCS retention policy cannot be shortened or removed.
**Fix:** Terraform ships with `is_locked = false`; a human locks it once D8 is confirmed (now written into D8).

### 23. Medium: Phase 1 acceptance cannot be fully proven by me
"Signs in with Workspace (2SV enforced)" needs a staging GCP project, IAP OAuth setup, a Workspace test user, and a human running `terraform apply`. 2SV enforcement is a Workspace admin setting the app cannot observe.
**Fix:** split acceptance into what I prove locally and what you prove on staging (done in the Phase 1 checklist).

## Product configuration

### 21. High: the config surface is not designed
The plan says rules are "data the firm can edit" and puts fee schedule and thresholds in `firm_config`, but there is no config format, no validation story, and no admin UI. Since everything firm-specific must be config, this is the product's core seam.
**Fix:** v1 = one versioned per-firm config file (YAML or JSON) validated by a Zod schema in `packages/core`, loaded into `firm_config` at deploy, edited by you (not by the firm). Admin UI later. Decide whether `firm_config` is one JSONB document or typed tables; this affects the Phase 1 schema.

### 22. Medium: integration interfaces are named after vendors
`calendly`, `gmail`, `docusign` as interface names make a firm on Acuity, Microsoft 365 or Dropbox Sign a rewrite instead of an adapter.
**Fix:** interfaces named `scheduler`, `mail`, `esign`, `intake`, `storage`, `ai`, with vendor implementations under each. Cheap now, expensive later.

## Over-built

### 24. Low: a lot of infrastructure for ~5 clients a week
Two Next.js apps, Cloud Tasks, Scheduler, KMS, CMEK, three environments. Most of it is defensible for the WISP story, but:
- Cloud Tasks could be replaced by a Postgres-backed queue drained by a Scheduler tick, removing one service and one IAM path.
- CMEK is not required by the Safeguards Rule (Google default encryption satisfies "encrypt at rest") and adds a footgun (destroyed key = destroyed data). Keep it if it helps sell the security story, but treat it as a choice.

### 25. Low: a 15-column board
Group columns by phase (Prep, Meeting, Documents, Approval, Letter) with the exact state as a chip; terminal states off the board behind a filter.

### 26. Low: the Excel import is firm-specific
Phase 7 imports "the" Excel tracker. For a product it should be a generic CSV importer with column mapping.

### 27. Low: CI deploys in Phase 1
"GitHub Actions to Cloud Build or Cloud Deploy" conflicts with "never deploy to staging/prod" for me. Phase 1 CI should run checks only; a deploy pipeline waits until a human owns staging.

## Missing or inconsistent

### 28. Low: naming drift between PLAN.md and CLAUDE.md
PLAN says `integrations/intake-form` and `integrations/gcs`; CLAUDE.md says `intake` and `storage`. I will follow CLAUDE.md (or item 22's names if approved).

### 29. Low: payments and retainers are not mentioned
Many firms collect a deposit or card on file at engagement. Fine to exclude; say so explicitly so a firm does not assume it.

### 30. Low: integration accounts are the real schedule risk
With no client, nobody is providing a Calendly paid plan, DocuSign developer account, Workspace test tenant, or GCP billing. These belong in Phase 1 prerequisites, not "provided promptly."

## Phase 0 deliverables not yet produced
Process map (needs a firm, or a written "assumed typical firm" map), `docs/security.md` outline, and the phased estimate and price. Not requested in this pass.
