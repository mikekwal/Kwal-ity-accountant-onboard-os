# Onboarding OS

A client-onboarding app for small US CPA firms. It replaces the usual mix of Calendly, an intake form, an Excel tracker, Dropbox and manual email with one pipeline where every new client has exactly one record and one stage, and stalled clients rise to the top.

**Status: clickable demo with fake data.** The screens work, but nothing is connected yet: no database, no real Google login, no live Calendly, Gmail, DocuSign or Claude. Everything you click is saved in your own browser only.

## Run the demo

Needs Node.js 20 or newer.

```bash
cd demo
npm install
npm run dev
```

Open http://localhost:3000.

What to try:
- **Board** (`/`): clients by stage, with stalled and "booked without intake" flags.
- **Client page** (click a card): next-step buttons, AI pre-meeting brief, Gmail draft preview, document checklist, quote, and an audit timeline that logs every click.
- **Owner approval**: switch "signed in as" to a staff user and the approve button locks.
- **Client portal** ("Open client portal view" on a client page): the upload-only page a client sees.
- **Dashboard**: clients by stage, stalled count, and the morning digest preview.
- **Reset** (top right) restores the demo data.

All names, emails and numbers in the demo are made up.

## How the real version is planned

| Doc | What it covers |
|---|---|
| [PLAN.md](PLAN.md) | Full implementation plan: scope, architecture, data model, pipeline states, phases |
| [CLAUDE.md](CLAUDE.md) | Working rules for building it with Claude Code, including the security rules for taxpayer data |
| [docs/architecture.md](docs/architecture.md) | Architecture, data flow, states and allowed transitions |
| [docs/decisions.md](docs/decisions.md) | The 11 product decisions and their defaults |
| [docs/plan-review.md](docs/plan-review.md) | Known gaps and risks in the plan |
| [docs/phase-1-checklist.md](docs/phase-1-checklist.md) | The next build phase and how each piece gets proven |

Planned stack: Next.js, Postgres, Google Cloud (Cloud Run, Cloud SQL, IAP), Claude on Vertex AI, Gmail API, Calendly, DocuSign.

## A note on client data

The real version will hold taxpayer data, which falls under the FTC Safeguards Rule and IRS Publication 4557. Never put real client data into this demo, its tests, or its fixtures.

## License

MIT, see [LICENSE](LICENSE). Free to use, copy and modify. Provided as is, with no warranty: if you run it for a real firm, the security and compliance work is yours.
