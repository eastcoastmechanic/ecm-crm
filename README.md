# ECM Platform — "Better than Jobber"

Full CRM + billing + AI diagnostics + client portal, purpose-built for East Coast Mechanical, structured to eventually be sellable to other contractors.

## Vision
One system that replaces Jobber, Square invoicing, and manual quoting — with Claude as the engine behind every estimate, invoice, proposal, and diagnostic call, and a client portal that gets ECM paid faster.

## Tech Stack
| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind + shadcn/ui | Fast solo dev, one codebase for internal app + client portal |
| Database | Postgres (via Supabase) | Deeply relational data (customer→property→equipment→job→invoice) |
| Auth | Supabase Auth | Built-in, multi-tenant ready via row-level security |
| AI | Claude API (structured JSON outputs) | Powers estimate/invoice generation + diagnostic tool |
| Payments | Stripe (or Stripe Connect if ever multi-tenant) | Client portal payments |
| Email | Resend + webhook inbound parsing | Automated follow-ups, contract renewals |
| Mobile | PWA first, React Native later if needed | One codebase, offline-capable |
| Hosting | Vercel (app) + Supabase (db/auth/storage) | Zero-ops for a solo dev |

## Repo Structure
```
ecm-crm/
  app/                 # Next.js routes
    (internal)/        # Tech-facing app: estimates, invoices, proposals, diagnostics
    (portal)/           # Customer-facing portal
    api/                 # API routes incl. Claude calls, Stripe webhooks, email webhooks
  lib/
    claude/              # Prompt templates + structured output schemas
    pricebook/            # Price book lookup logic
  db/
    schema.sql            # Core Postgres schema
  docs/
    ROADMAP.md            # Phased build plan
```

## Preventive maintenance

Maintenance visits use checklists stored in Postgres, not hardcoded in the page. Apply `db/migrations/0048_preventive_maintenance.sql` before using the screens. The migration is not applied by the deploy. Local development can open `/pm/preview` for a sample checklist and report with no database. That route is absent in production.

- **Checklists.** Maintenance → New checklist. Pick the job (maintenance jobs are listed first), the equipment on that property, and the residential or commercial template. Each item is pass, fail, or N/A, with the readings that item needs (µF, psig, °F, amps, ppm, inches of water column), a note, and a photo. Supply and return temperatures keep the temperature split in step until the tech types a different split. Photos go in the private `pm-photos` bucket. Save as you go. Filing the report requires a technician name and a result on every item. Office staff can edit template items under Maintenance → Edit templates; a checklist already started keeps the copy it was created with.
- **Data plate.** On an equipment row, Scan data plate takes a photo and proposes manufacturer, model, serial, and manufacture date. The date is the one printed on the plate, or a Carrier-family week/year or Goodman-family year/month decode when the brand is one of those and no date is printed. Nothing is written until Save confirmed plate. A value already on the equipment is kept unless Replace is checked. New equipment uses the same rule: the add form is a proposal until Add Equipment. OCR is Claude vision through `ANTHROPIC_API_KEY` (already used for nameplates). There is no second key and nothing is hardcoded.
- **Report.** File report writes a `documents` row with `type = pm_report`, linked to the job, customer, and property. The printable page is `/pm/<id>/report` and the PDF is `/pm/<id>/report/pdf`. The header is East Coast Mechanical, the tagline BUILT WITH PRIDE, INSTALLED WITH PRECISION, (774) 343-6369, and joshcrowleyecm@outlook.com. The document is inserted as `draft`, so the customer portal's "not a draft" policy does not show it until someone emails it. The portal page renders a PM report on its own and does not treat it as an estimate.
- **Truck CRM.** Nothing calls ecm-field.grok.me. The read hook is `GET /api/integrations/truck-crm/pm?job_id=<uuid>` with `Authorization: Bearer` set to the same secret the field board already accepts (`FIELD_BOARD_SECRET`, `FIELD_BOARD_APP_KEY`, `CRON_SECRET`, or `MCP_API_KEY`). The JSON is version 1: checklist id, status, template, tech, summary counts, failures, and the CRM paths for the checklist and the report.

Techs signed in with the tech role can open `/pm` on a phone. The field-board APIs are unchanged.

