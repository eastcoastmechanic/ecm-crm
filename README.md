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

## Build Order (see docs/ROADMAP.md for detail)
1. Data backbone: Customers, Properties, Equipment, Price Book
2. AI-generated Estimates/Invoices/Proposals
3. Diagnostic tool (equipment specs + readings → Claude analysis)
4. Client portal + Stripe payments
5. Email automation
6. Scheduling/dispatch
