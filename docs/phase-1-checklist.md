# Phase 1 checklist: Foundation

Status: **PROPOSED, awaiting approval.** No application code until approved.

Goal (PLAN.md section 6): monorepo, infra as code, staff auth, full schema with hardened audit log, `transition()` state machine, board UI, synthetic seed.

## A. Needs your call before I start

These review items change what Phase 1 builds. My default is in brackets; say yes, no, or change.

| Review item | Question | My default |
|---|---|---|
| 1 | Google Workspace firms only, or plan for Microsoft 365? | [Workspace only for v1, but name interfaces generically so M365 is an adapter later] |
| 3 | Engagement letter before or after document collection? | [Letter before docs, optional prior-year-return slot before quote] |
| 6 | Separate `apps/worker` service for webhooks and jobs? | [Yes] |
| 8 | Change requests as an overlay instead of a `CHANGE_REVIEW` state? | [Yes, overlay] |
| 9 | Add skip edges (with required reason) and import-into-any-state? | [Yes] |
| 10 | Add `contacts` + engagement participants? | [Yes] |
| 21 | Firm config as a versioned file validated by Zod, loaded into `firm_config` (JSONB)? | [Yes] |
| 22 | Generic interface names (`scheduler`, `mail`, `esign`, `ai`, ...)? | [Yes] |

Item 7 (audit chain locking, `TRUNCATE` guard, role ownership) I will do regardless; it is how the plan's audit rule has to be implemented to actually hold.

## B. Prerequisites

| Need | Why | Who |
|---|---|---|
| Docker Desktop running | Local Postgres 16 for dev, integration tests and e2e. The daemon was not running when I checked. | You (start it) |
| pnpm | Not installed. I enable it with `corepack enable` (ships with Node 24). | Me, with your OK |
| Terraform + tflint (+ checkov, optional) | Not installed. Needed for `fmt`, `validate`, static security checks. Install via winget. | Me, with your OK |
| `git init` in this folder | Not a git repo yet. Small commits per CLAUDE.md. | Me |
| GitHub repo (optional) | Only to prove CI actually runs. Without it, I run the same steps locally. | You |
| Staging GCP project, billing, Workspace test tenant with 2 users (one staff, one not) | Only for the staging half of the acceptance proof and for `terraform plan` against real state. | You |

## C. Tasks

### 1. Repo scaffold
- [ ] `git init`, `.gitignore`, `.editorconfig`, `.env.example` (placeholder keys only)
- [ ] pnpm workspace: `apps/staff`, `apps/portal`, `apps/worker` (if item 6 approved), `packages/core`, `packages/db`, `packages/integrations`
- [ ] TypeScript strict base config; ESLint (flat config, typescript-eslint, `no-console` so everything goes through the shared logger, import-boundary rule: `apps/portal` cannot import staff-only modules); Prettier
- [ ] Vitest workspace; Playwright; `docker-compose.yml` with Postgres 16
- [ ] Root scripts: `dev`, `typecheck`, `lint`, `test`, `test:e2e`, `db:migrate`, `db:seed`, `verify:audit`

**Proof:** from a clean clone, `pnpm install && pnpm typecheck && pnpm lint && pnpm test` passes; I paste the output.

### 2. `packages/core`
- [ ] Shared logger with scrubber (drops known PII keys, masks email, phone, SSN/EIN/ITIN and account-number patterns in values)
- [ ] Firm config Zod schema + loader + `config/firm.example.yaml` for a synthetic firm. Covers name, time zone, holidays, roles-to-capabilities (D7), stall thresholds (D10), retention placeholders (D8). App refuses to start on invalid config.
- [ ] Allowed-transitions table as data (from architecture.md section 8, plus approved changes)
- [ ] `transition(engagementId, toState, actor, reason)`: locks the engagement row, checks the edge and actor capability, computes `stale_at` from config, writes state + audit event in one transaction
- [ ] Audit append: canonical JSON, SHA-256 over `prev_hash` + event, serialized with `pg_advisory_xact_lock`
- [ ] Business-day calculator (firm time zone + holidays)

**Proof:**
- Logger: unit tests feed PII-shaped values and assert none appear in output.
- Config: tests for valid config, each invalid field, and startup refusal.
- Transitions: table-driven test over every from/to pair: every allowed edge succeeds, every other pair is rejected with no DB change. Capability test: `staff` cannot do owner-only edges.
- Atomicity: force the audit insert to fail and assert the state did not change.
- Concurrency: two simultaneous transitions on one engagement, exactly one wins; 100 parallel transitions across engagements, then the chain verifies.
- No direct state writes: a lint rule/test that fails if any file outside `packages/core` writes `engagements.state`.

### 3. `packages/db`
- [ ] Drizzle schema for all PLAN.md section 4 tables (+ approved changes), drizzle-kit migrations
- [ ] Two DB roles: `onboarding_owner` (owns tables, runs migrations) and `onboarding_app` (runtime; `INSERT, SELECT` only on `audit_events`; no `TRUNCATE`)
- [ ] Triggers on `audit_events`: row-level `BEFORE UPDATE OR DELETE` and statement-level `BEFORE TRUNCATE`, both raise
- [ ] No cascading foreign keys into `audit_events`
- [ ] Seed: synthetic only (fixed faker seed, `@example.test` emails, 555-01xx phone numbers, no SSN/EIN-shaped values), idempotent
- [ ] `scripts/verify-audit-chain.ts` (`pnpm verify:audit`): recomputes the chain, exits non-zero naming the first bad row

**Proof:**
- Integration tests against Postgres 16 in Docker, connected as `onboarding_app`: `UPDATE`, `DELETE`, `TRUNCATE` on `audit_events` each fail; `ALTER TABLE ... DISABLE TRIGGER` fails. As `onboarding_owner`: `UPDATE` and `DELETE` still blocked by the trigger.
- Seed test: running seed twice gives the same row counts; every email/phone matches the synthetic patterns.
- `verify:audit` passes after seed + e2e. Negative test: in a throwaway DB, a superuser disables the trigger and edits one row; `verify:audit` fails and names that row.

### 4. `apps/staff`
- [ ] Request guard on every route: verify the IAP JWT (`x-goog-iap-jwt-assertion`, ES256 against Google's IAP JWKS, `iss`, `aud` from config, expiry), map email to an active `staff_users` row, 403 otherwise
- [ ] Dev mode uses the **same verification code** with a local issuer and JWKS (no bypass branch). Startup guard refuses a non-Google issuer when running on Cloud Run or with `NODE_ENV=production`.
- [ ] Board: columns by state (grouped per review item 25 if you agree), Stalled badge derived at read time
- [ ] Manual "create client + engagement" (Zod-validated)
- [ ] Client detail page: data + timeline from `audit_events`; buttons only for transitions the current user is allowed to make

**Proof:**
- Guard unit tests: active staff gets 200; unknown email 403; inactive staff 403; bad signature, expired, wrong audience, wrong issuer, missing header each 401; production guard rejects the dev issuer.
- Playwright e2e (local, dev issuer): sign in as seeded staff, create a client, move it along the full path to `ACTIVE` (system/webhook steps driven through fakes), assert each move appears in the timeline with actor and time; sign in as an unknown user and get 403.
- axe-core accessibility check on the board and detail page, zero serious violations.
- Log check: e2e captures server logs and asserts no seeded names, emails or phone numbers appear.

### 5. `apps/portal` and `apps/worker`
- [ ] Portal: scaffold and health route only; no data access yet (Phase 4)
- [ ] Worker (if item 6 approved): scaffold, health route, OIDC verification middleware for job routes with tests

**Proof:** builds and typechecks; lint boundary rule proves the portal imports nothing staff-only.

### 6. `packages/integrations`
- [ ] Interfaces + fakes skeleton only (names per item 22). No real API calls in Phase 1.

**Proof:** typecheck.

### 7. `infra/` Terraform
- [ ] Modules: project services, VPC + Cloud Run egress, Cloud SQL (private IP, CMEK, automated backups, PITR), KMS keyring and keys, buckets (CMEK, versioning, uniform access, public access prevention, retention policy **not locked**), Secret Manager, Artifact Registry, Cloud Run services, Cloud Tasks queue, Scheduler, IAP on staff
- [ ] `env/staging.tfvars.example`, `env/prod.tfvars.example`; remote state backend config per firm
- [ ] Least-privilege service accounts per service

**Proof:** `terraform fmt -check`, `terraform validate`, `tflint`, `checkov` clean (or each finding explained). `terraform plan -var-file=env/staging.tfvars` output shown **only if** a staging project and credentials exist; otherwise marked unverified. I never run `apply`.

### 8. CI
- [ ] GitHub Actions: install, typecheck, lint, unit + integration tests (Postgres service container), e2e, `verify:audit`, `terraform fmt` + `validate`. No deploy job.

**Proof:** I run the identical steps locally. CI itself stays unverified until it runs on GitHub.

### 9. Docs
- [ ] Update `architecture.md` with approved changes
- [ ] `docs/security.md` outline (PLAN.md section 9), `docs/runbook.md` stub, local dev section in a README

## D. Acceptance criteria and how each is proven

| PLAN.md acceptance criterion | What I prove locally | What needs you on staging |
|---|---|---|
| Staff user signs in with Workspace (2SV enforced) | Guard tests + e2e with the dev issuer, same code path as prod | You `terraform apply` to staging, sign in with the test Workspace user. 2SV enforcement is a Workspace admin setting: screenshot of the admin console. I cannot verify this part. |
| Creates a client manually, moves it through states, every move in the timeline | Playwright e2e | Same flow by hand on staging |
| Unknown Google account is rejected | Guard tests + e2e 403 | Sign in with a non-staff Google account. Check both layers: IAP denies if not granted, app returns 403 if IAP lets it through |
| `UPDATE audit_events` fails at the DB | Integration tests as the app role (plus `DELETE`, `TRUNCATE`, disable-trigger) | Same test against staging Cloud SQL through the Auth Proxy |
| `verify-audit-chain` passes | After seed + e2e + concurrency test, plus the tamper test that must fail | Run against staging after the manual flow |

At the gate I report: what was built, test output, the items above marked proven / unverified, and anything I deviated on.
