# CLAUDE.md — Onboarding OS

Internal client-onboarding app for a US CPA firm. Replaces Calendly + intake form + Excel tracker + Dropbox + manual email with one app on Google Cloud. Full plan: `PLAN.md`. Decisions: `docs/decisions.md`.

## How to work in this repo
- Work **one phase of PLAN.md at a time**. At the end of each phase, stop: summarize what was built, list what you could not verify, and wait for approval before starting the next phase.
- Before starting a phase, read its tasks and acceptance criteria and write a short checklist. Mark items done as you go.
- If a decision in `PLAN.md` section 7 is unresolved and blocks you, stop and ask. Don't guess on anything involving client data, auth, or money.
- Prefer small commits with clear messages. Run `pnpm typecheck && pnpm lint && pnpm test` before every commit.
- **Never run `terraform apply` or deploy to staging/prod.** Run `terraform plan` and show the output; a human applies.

## Stack
TypeScript, pnpm workspaces, Next.js (App Router), Postgres 16 + Drizzle, Zod, Vitest, Playwright, Terraform, Google Cloud (Cloud Run, Cloud SQL, Cloud Tasks, Cloud Scheduler, Secret Manager, Cloud KMS, GCS, IAP, Identity Platform), Claude via Vertex AI, Gmail API, Calendly API v2, DocuSign eSignature + Connect.

## Layout
```
apps/staff       board, client pages, approvals, /api/webhooks/*, /api/jobs/*
apps/portal      client checklist + uploads (upload-only)
packages/core    state machine, rules engine, audit, redaction
packages/db      schema, migrations, seed (synthetic only)
packages/integrations  calendly, intake, gmail, docusign, claude, storage — each with a real client, a fake, and fixtures
infra/           terraform
docs/            architecture, security, decisions, runbook
```

## Commands
- `pnpm dev` — staff + portal with local Postgres and fake integrations
- `pnpm db:migrate` / `pnpm db:seed`
- `pnpm test` / `pnpm test:e2e`
- `pnpm verify:audit` — recompute audit hash chain
- `cd infra && terraform plan -var-file=env/<env>.tfvars`

(Create these scripts in Phase 1 if they don't exist.)

## Hard rules — security and client data
This app stores taxpayer data. FTC Safeguards Rule and IRS Pub 4557 apply.

1. **Real client data never leaves prod.** Dev and staging use synthetic seed data and recorded fixtures only. Never paste real data into tests, fixtures, or prompts.
2. **No PII in logs.** Never log names, emails, phone numbers, SSN/EIN/ITIN, account numbers, document contents, or prompt text. Log IDs and hashes. Use the shared logger, which scrubs.
3. **Secrets live only in Secret Manager.** Never commit `.env` files with real values. `.env.example` lists keys with placeholders.
4. **Nothing is sent to a client without a human trigger.** The system may create Gmail drafts. Sends to clients happen only from a staff click, and that click is audit-logged. Internal staff digests may send automatically.
5. **All state changes go through `transition()`** in `packages/core`. No direct `UPDATE engagements SET state`. `transition()` writes the state and the audit event in one DB transaction.
6. **`audit_events` is append-only.** Never write code that updates or deletes it. Never weaken the DB trigger or role grants.
7. **Every external call that has an effect** (Gmail draft/send, DocuSign envelope, portal invite, file move) writes an audit event.
8. **Webhooks:** verify signatures before anything else, store the raw event keyed by provider event ID, enqueue, return 200. Handlers must be idempotent — replaying an event changes nothing.
9. **Claude calls go only through `packages/integrations/claude`.** Every prompt passes through `redact()`. Tax documents are never sent to the model. Model ID and region come from config.
10. **Portal is upload-only.** Clients can never download stored files or see anything outside their own engagement. Every portal query is scoped by the authenticated engagement ID — test this.
11. **Uploads land in `quarantine/`** and move to `clients/` only after validation.
12. **Staff routes verify the IAP JWT** on every request and map it to an active `staff_users` row. Unknown users get 403.

## Conventions
- Validate all external input with Zod at the boundary.
- Every integration has an interface in `packages/integrations/<name>/index.ts`, a real implementation, and a fake. Tests use fakes; staging uses real sandboxes.
- Dates stored as `timestamptz` UTC; display in the firm's time zone from `firm_config`.
- Rules for required documents are data (config), not if-statements scattered through the code.
- UI: plain, fast, accessible. Board first; no decorative work until flows are complete.

## Definition of done (every task)
- Types, lint, and tests pass.
- New behavior has tests, including the failure path.
- Any new external effect writes an audit event.
- No PII added to logs (check the diff).
- Docs updated if behavior, config, or infra changed.
