# Decisions log

Onboarding OS is a reusable product: one deployment per firm, with everything firm-specific in firm config. There is no firm in discovery yet, so every decision below adopts the "Recommendation" column of PLAN.md section 7 as the **product default** and is marked **ASSUMED - confirm with first firm**.

When a firm confirms or overrides a decision, change its status to `CONFIRMED (<firm>, <date>, <who>)` and add a line under that decision's History. If the override is a config change, it goes in that firm's config, not here; this file records the product default.

Status key:
- **ASSUMED** - product default adopted without a firm. Safe to build on, but a firm may change it.
- **CONFIRMED** - signed off by a named firm contact.

Open items raised in review that are not in PLAN.md (operator model, letter-before-docs, Microsoft 365 support, and others) are listed in [plan-review.md](plan-review.md). They are not decisions yet.

## Summary

| # | Topic | Product default | Status | Firm override lives in |
|---|---|---|---|---|
| D1 | Intake form | Calendly booking questions where they fit; generic signed-webhook adapter (first target: Google Forms via Apps Script) otherwise | ASSUMED | config: `intake.source` |
| D2 | Tax organizer | Attach the organizer the firm's tax software produces; portal checklist does the tracking | ASSUMED | config: `organizer.mode` |
| D3 | Document storage | GCS bucket (CMEK, versioned) behind the portal | ASSUMED | code (storage adapter) + infra |
| D4 | DocuSign | Confirm plan includes API access; build against the developer sandbox | ASSUMED | config: template IDs; account in Secret Manager |
| D5 | Portal second factor | Identity Platform: email link + SMS or authenticator (TOTP) code | ASSUMED | config: `portal.mfa_methods` |
| D6 | Gmail access | Per-user OAuth, `gmail.compose` scope only | ASSUMED | config: `mail.auth_mode` |
| D7 | Roles | `owner` approves and changes pricing; `staff` does everything else | ASSUMED | config: role-to-capability map |
| D8 | Retention | Firm's call; retention is config. Until set: keep everything, delete nothing, lock nothing | ASSUMED | config: `retention.*` |
| D9 | Safeguards scope (5,000-consumer threshold) | Build as if every 314.4 element applies | ASSUMED | docs only (security.md mapping) |
| D10 | Stall thresholds | PLAN.md section 5 defaults | ASSUMED | config: `stall_thresholds.*` |
| D11 | Claude access | Claude on Vertex AI, US regional endpoint, in the firm's GCP project | ASSUMED | config: `ai.model_id`, `ai.region` |

---

## D1. Which tool is the intake form, and can it send a webhook?

**Default:** Use Calendly booking questions as the intake when the firm's questions fit there (read from the invitee's `questions_and_answers`). For longer or conditional forms, use a generic signed-webhook intake adapter. The first concrete adapter is Google Forms via an Apps Script `onFormSubmit` trigger that posts a signed payload.

**Status:** ASSUMED - confirm with first firm.

**Why:** If intake questions are part of booking, "booked without intake" (leak #1) mostly disappears because the answers arrive with the booking. Google Forms is free and native to the Workspace stack the plan already assumes.

**If the firm chooses differently:**
- **Calendly questions only:** Phase 2 matching logic becomes a fallback path rather than the main path. Calendly question types are limited (no real conditional logic), so the rules engine in Phase 4 gets less detail and may need a short follow-up form.
- **Typeform / Jotform / other:** one new adapter in `packages/integrations/intake` (roughly 1 to 2 days each). Signature verification differs by tool; a tool with no request signing needs a per-firm secret in the webhook path plus payload validation, and that weaker check must be noted in `security.md`.
- **No webhook at all (e.g. a PDF form or email):** intake becomes a manual staff step ("paste/enter intake") and the `intake_missing` flag stays until staff clear it. Leak #1 is then only surfaced, not fixed.

**Config / code touchpoints:** `intake.source` (`calendly_questions` | `webhook:<adapter>`), adapter secret in Secret Manager, field mapping from form questions to the canonical intake schema (config, so rules don't depend on one form's wording).

**History:** 2026-10-22 adopted as default.

---

## D2. Where does the tax organizer come from?

**Default:** v1 attaches the organizer the firm's tax software already produces (UltraTax, Lacerte, Drake, CCH, etc.). The app does not generate organizers. The portal checklist, driven by the rules engine, is what tracks which documents are outstanding.

**Status:** ASSUMED - confirm with first firm.

**Why:** Every major tax package produces organizers pre-filled from prior-year data. Rebuilding that is large and adds no value in v1.

**If the firm chooses differently:**
- **Firm wants the app to generate the organizer:** new scope (questionnaire builder + PDF output), roughly 1 to 2 extra weeks in Phase 4, and the organizer content becomes another firm-editable config surface.
- **Firm's tax software delivers organizers through its own client portal:** kickoff sends a link/instruction instead of an attachment. Clients then have two portals to deal with; see plan-review item on portal overlap.
- **Firm sends no organizer:** kickoff step skips the attachment; nothing else changes.

**Config / code touchpoints:** `organizer.mode` (`attach_file` | `external_link` | `none`), kickoff email template.

**History:** 2026-10-22 adopted as default.

---

## D3. Document storage: GCS, keep Dropbox, or Google Drive?

**Default:** Encrypted GCS bucket (CMEK, object versioning, uniform bucket-level access, public access prevention) behind the client portal. Uploads land in `quarantine/` and move to `clients/{clientId}/{engagementId}/` after validation.

**Status:** ASSUMED - confirm with first firm.

**Why:** Keys, access control, and access logs all sit in one GCP project, which is one fewer vendor to oversee in the firm's WISP. GCS signed URLs make an upload-only portal straightforward.

**If the firm chooses differently:**
- **Keep Dropbox:** storage adapter targets Dropbox Business API. CMEK and unified Cloud Audit Logs no longer cover documents; Dropbox becomes a service provider in `security.md`. Upload-only behaviour must be rebuilt on Dropbox primitives (file requests or app-folder uploads) and re-tested. Staff convenience goes up; security story gets weaker and more complex.
- **Google Drive (shared drive):** storage adapter targets the Drive API. Access is governed by Drive sharing, which a firm admin can loosen outside the app; the "clients can never download" guarantee depends on the portal never exposing Drive links. CMEK is available only on some Workspace editions.
- In both cases the `storage` interface keeps this an adapter swap, not a rewrite, but Phase 4 upload tests and `security.md` sections 2, 4 and 7 change.

**Config / code touchpoints:** `storage.provider`, bucket names and KMS key in Terraform tfvars.

**History:** 2026-10-22 adopted as default.

---

## D4. Does the DocuSign plan include API access? Which templates?

**Default:** Assume the firm uses DocuSign. Build and test against the DocuSign developer (demo) sandbox; confirm before Phase 5 that the firm's production plan includes eSignature API access and that the integration can pass DocuSign's go-live review. Engagement letter templates are referenced by template ID in config, with merge fields mapped from engagement and quote data.

**Status:** ASSUMED - confirm with first firm.

**Why:** Sandbox-first lets Phase 5 be built and tested without the firm's account. Plan tier and go-live are the usual blockers, so they should be checked early.

**If the firm chooses differently:**
- **Plan lacks API access:** the firm upgrades, or the product uses another e-sign provider. Name the integration interface `esign` (not `docusign`) so a second provider is an adapter.
- **Firm uses another e-sign tool (Dropbox Sign, Adobe Sign, or e-sign inside their practice-management or tax software):** new adapter, or a manual "mark letter signed" step with upload of the signed PDF, audit-logged. Phase 5 shrinks in the manual case.
- **Multiple letter templates by service type:** config maps service type to template ID; no code change.

**Config / code touchpoints:** `esign.provider`, `esign.templates` (service type to template ID + merge-field map), DocuSign integration key / user ID / RSA key in Secret Manager, Connect HMAC secret in Secret Manager.

**History:** 2026-10-22 adopted as default.

---

## D5. Second factor for the client portal

**Default:** Identity Platform for portal auth: email link as first factor, plus SMS code or authenticator (TOTP) code as second factor. Client chooses SMS or TOTP at enrollment. Firm's Qualified Individual should confirm.

**Status:** ASSUMED - confirm with first firm (specifically with their Qualified Individual).

**Why:** The Safeguards Rule (314.4(c)(5)) requires MFA for anyone accessing customer information systems. Email link alone is one factor. SMS is the lowest-friction second factor for typical tax clients; TOTP is offered for clients who want it.

**If the firm chooses differently:**
- **TOTP only (no SMS):** stronger against SIM-swap, but expect more support calls from less technical clients. Config change.
- **Email link only:** not acceptable as the product default because it is single-factor. If a firm insists, it must be recorded as an accepted risk in their `security.md` by the Qualified Individual. Requires a config flag that is off by default and loudly logged when on.
- **Firm already has a client portal it wants to use:** see plan-review item on portal overlap; the upload portal may not be needed at all.
- SMS has a per-message cost on Identity Platform and needs billing enabled on the project; this goes in the firm's cost estimate.

**Config / code touchpoints:** `portal.mfa_methods` (`["sms","totp"]`), Identity Platform tenant config in Terraform.

**History:** 2026-10-22 adopted as default.

---

## D6. Gmail access: per-user OAuth or domain-wide delegation?

**Default:** Per-user OAuth with only the `gmail.compose` scope. Each staff member connects their mailbox once; the app creates drafts in that mailbox and never sends to clients on its own.

**Status:** ASSUMED - confirm with first firm.

**Why:** Narrowest access. A leaked credential exposes one mailbox's compose rights, not every mailbox in the domain.

**If the firm chooses differently:**
- **Domain-wide delegation (zero per-user setup):** a Workspace admin authorises one service account for `gmail.compose` across the domain. Use keyless impersonation (IAM Credentials `signJwt`), never a downloaded JSON key. Blast radius is the whole domain's compose rights, which must be stated in `security.md`. Code change is limited to the `mail` adapter's auth.
- **Firm is on Microsoft 365, not Google Workspace:** Gmail does not apply, and neither does Workspace SSO through IAP. This is a product-level question, not a config switch; see plan-review item 1.

**Config / code touchpoints:** `mail.auth_mode` (`per_user_oauth` | `domain_wide_delegation`), OAuth client in Secret Manager, storage for per-user refresh tokens (open question in plan-review).

**History:** 2026-10-22 adopted as default.

---

## D7. Roles: who can approve, who can waive documents, who sees fees?

**Default:** Two roles. `owner` approves engagements, approves change requests, and changes pricing. `staff` does everything else, including waiving document slots with a reason. Both roles can see fees.

**Status:** ASSUMED - confirm with first firm.

**Why:** Small firms rarely need more. Approvals and pricing are the only actions with money attached.

**If the firm chooses differently:** Build permissions as a role-to-capability map in config from Phase 1 (`approve_engagement`, `approve_change`, `edit_pricing`, `waive_document`, `view_fees`, `manage_staff`, ...), checked by `transition()` and route guards. Then:
- **Add a `reviewer` role** (owns `DOCS_COMPLETE`), **hide fees from staff**, or **restrict waivers to owners**: config change only.
- **Per-person exceptions** (one senior staff member can approve): add a per-user capability override; small code change.

**Config / code touchpoints:** `roles` map in firm config; `staff_users.role`.

**History:** 2026-10-22 adopted as default.

---

## D8. Retention periods for documents and audit logs

**Default:** Retention is firm config. Until a firm sets values, the product **keeps everything and deletes nothing**, and the audit export bucket's retention policy is set but **not locked**.

**Status:** ASSUMED - confirm with first firm.

**Why:** Retention periods are a legal and professional-standards decision for the firm, not the product. Locking a GCS retention policy is irreversible (it cannot be shortened or removed), so it must wait for a confirmed value.

**If the firm chooses differently:** Set `retention.documents`, `retention.prospects_not_engaged`, `retention.audit_events` in config. Phase 7 adds a retention job that deletes documents and client PII past their period and writes an audit event per deletion. Audit events themselves contain no PII, so they can outlive the client record (foreign keys from `audit_events` must not cascade). Once the firm confirms the audit retention period, a human locks the bucket policy via Terraform.

**Config / code touchpoints:** `retention.*`; Terraform `retention_policy.is_locked` default `false`.

**History:** 2026-10-22 adopted as default.

---

## D9. Approximate number of consumers whose data the firm holds

**Default:** Build and document as if every element of 16 CFR 314.4 applies, regardless of the 5,000-consumer exemption in 314.6.

**Status:** ASSUMED - confirm with first firm.

**Why:** Costs little extra in the product, and a firm that grows past 5,000 does not have to retrofit.

**If the firm chooses differently:** Under 5,000 consumers, the elements exempted by 314.6 (written risk assessment, continuous monitoring or annual penetration testing, written incident response plan, annual report to the board) become optional for the firm. No code change; only the mapping table in `security.md` marks them "provided, not required."

**Config / code touchpoints:** none.

**History:** 2026-10-22 adopted as default.

---

## D10. Stall thresholds per state

**Default:** PLAN.md section 5 defaults:

| State | Stale after |
|---|---|
| `BOOKED` | none (flag `intake_missing` instead) |
| `PREP_READY` | meeting is under 24h away and draft not sent |
| `PREP_SENT` | meeting end + 4h with no outcome recorded |
| `MET` | 2 business days without kickoff |
| `DOCS_REQUESTED` | 5 days with no uploads |
| `DOCS_IN_PROGRESS` | 7 days since last upload |
| `DOCS_COMPLETE` | 2 business days |
| `PENDING_APPROVAL` | 2 business days |
| `CHANGE_REVIEW` | 2 business days |
| `LETTER_SENT` | 5 days unsigned |

**Status:** ASSUMED - confirm with first firm.

**Why:** Reasonable starting points; the firm will tune them after a few weeks of real use.

**If the firm chooses differently:** Config only. Each threshold is `{ amount, unit: hours | days | business_days, anchor: state_entered | meeting_start | meeting_end | last_upload }`. Business days use the firm's time zone and a holiday list from config. A firm may also want different thresholds during tax season; supporting a date-ranged override is a small addition to the same config shape.

**Config / code touchpoints:** `stall_thresholds.<STATE>`, `timezone`, `holidays`.

**History:** 2026-10-22 adopted as default.

---

## D11. Claude via Vertex AI or the direct API with zero data retention?

**Default:** Claude on Vertex AI in a US regional endpoint, inside the firm's own GCP project. Model ID and region come from config.

**Status:** ASSUMED - confirm with first firm.

**Why:** Processing stays inside the firm's GCP project and existing Google agreement, so no new AI vendor appears in the WISP. Auth uses the service account, so there is no API key to manage.

**If the firm chooses differently:** Direct Anthropic API with a zero-data-retention agreement: a second implementation of the `claude` integration (same interface, same `redact()` gate), an API key in Secret Manager, and Anthropic listed as a service provider in `security.md` section 7. Model availability by Vertex region must be checked per firm before go-live either way.

**Config / code touchpoints:** `ai.provider` (`vertex` | `anthropic`), `ai.model_id`, `ai.region`.

**History:** 2026-10-22 adopted as default.
