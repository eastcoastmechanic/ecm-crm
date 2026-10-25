# ECM CRM: project instructions for Claude Code

Owner: Josh Crowley, East Coast Mechanical (ECM), licensed HVAC and plumbing, South Shore and Cape Cod, MA. Solo operator, hands-on. Keep tone field-tech plain, no corporate fluff.

Repo: eastcoastmechanic/ecm-crm
Live: https://ecm-crm.vercel.app
Vercel team: eastcoastmechanics-projects. GitHub org/user: eastcoastmechanic.
Stack: Next.js App Router, Tailwind, Supabase/Postgres, Vercel.
Internal app: `app/(internal)`. Customer portal: `app/(portal)`.

## Working rules (always)
- Ship code in the live repo. No throwaway copies.
- Feature branch off main. Never commit to main unless Josh says so.
- One change per PR. Flow: PR, Vercel preview, Josh tests, Josh says "merge N".
- Before opening a PR for Josh to test: `tsc`, lint and build pass, review bot clean, CI green.
- Never run production migrations. A change that needs a DB column ships as a SQL file/block for Josh to run and verify (like 0050, 0051, 0052).
- Never print secrets, .env contents or service-role keys.
- No invented customer data, prices, visit counts or job details. If a value is unknown, add a field and let Josh fill it in.
- Read the real code before planning. Earlier plan docs were wrong several times because they were written from memory. Check the repo first.
- Match existing patterns: server actions, existing UI components, inline `{error}` form errors (see `AddLeadModal`), not thrown errors.
- Prefer finishing a usable slice over starting a new unfinished module.

## Business defaults
- Labor $125/hr (code reads env `HOURLY_LABOR_RATE`; verify value).
- 50% deposit / 50% completion.
- Square is still used for some catalog and invoicing. Square sync exists. Never let a sync downgrade a `paid` invoice.
- Texts only go to customers with `sms_consent`.
- Times and reminder windows use America/New_York, not UTC.

## Role rules
- Roles: owner, office, tech. Only one staff row existed at last audit (owner).
- Techs never see prices. Anything a tech can open fetches only non-money fields; money components are hidden server-side, not just styled away.
- Money, send and delete server actions need `requireRole()` inside the action.
- Calendar/dispatch edits jobs only through existing job actions so Planner/Graph sync and customer notifications keep firing.
- Field Board status changes go through `updateJobStatus` / job-lifecycle.

## Where things stand (as of 2026-10-25, verify with `gh pr list`)
- Phase 1 (owner alerts, job billing line, payment link, deposit tracking) merged: #44 to #47.
- Phase 2 (truck app for techs: job card details, tech account page, service report access, install report access, inventory deduction, tech hours) merged: #48 to #52.
- #53 (inventory double-deduction fix) merged.
- #54 (CLAUDE.md and docs/ecm reference docs) merged.
- Earlier merged: #41 (signed maintenance contract creates plan), #42 (multi-unit install report, migration 0050), #43 (customer/property fields, access notes, migration 0051), #33 (Schedule job button).
- Anon DB/storage policies were locked down. Photo buckets were still public after that lockdown (Phase 5 item).

## Phase 3 (next): scheduling and recurring revenue
Order, one PR each:
0. Read-only: list real plan names, visit counts, start dates from the DB. No code.
1. Schedule `job-reminders` in `vercel.json` (check Vercel plan allows sub-daily cron; if not, one 7:00 ET morning digest to Josh and each tech). Also remind the assigned tech.
2. `/dispatch` calendar (office/owner only): day/week, column per tech plus Unassigned, click-to-edit first, drag-and-drop later. Keep the route optimizer link.
3. Recurring maintenance visits from plans: `maintenance_visits` table (SQL for Josh), daily cron creates the next due visit as an unscheduled maintenance job, "Needs scheduling" list, customer reminder to book (text only with consent, else email) plus follow-up, PM checklist starts from the right template, overdue plan visits show on dashboard.
4. Optional: customer self-confirm link, lands as an owner alert.

Open decisions for Josh (visits per plan blocks step 3):
- Visits per plan per year and which months.
- Reminders: text and email, or text first and email only without consent.
- Tech reminders: morning digest or one text before each job.
- Vercel plan cron frequency (Claude checks in step 1).

## After Phase 3
- Phase 4: lead pipeline board, good/better/best estimates, text review requests (plus one reminder), seasonal/lapsed-customer campaigns once consent is confirmed.
- Phase 5: private photo buckets with signed URLs, OAuth registration rate limit, narrow Field Board secrets, tests on money paths (contract terms, renewal cron, invoice totals), reports, payroll/time export, optional push to Square.

## Known open issues from the 2026-10-21 audit (not yet fixed unless listed above)
- Admin/copilot routes accept `Bearer undefined` if the secret env var is unset. `lib/cron-auth.ts` does not exist: each cron route has its own secret check, as do `lib/field-board.ts` and `lib/oauth.ts`. Build one shared fail-closed, timing-safe helper as part of this fix.
- `/api/internal-chat` has ungated destructive tools.
- Square sync can un-pay a Stripe-paid invoice (`square-sync.ts`); Stripe webhook lacks amount/payment_status check and idempotency.
- Maintenance renewal price hardcoded $299 and `end_date` not rolled forward.
- SMS: STOP/START not handled, some sends skip consent, senders swallow HTTP errors.
- No `loading.tsx`, most actions throw instead of returning inline errors.
- `@ts-nocheck` still in `estimate-routing.test.ts`; 26 stale branches to clean.

## Reference docs
Plans and audits live in `docs/ecm/`. Read them when planning, but trust the code over the docs.
@docs/ecm/ecm-crm-audit-2026-10-21.md
@docs/ecm/ecm-crm-master-plan-2026-10-22.md
@docs/ecm/ecm-crm-phase2-plan-2026-10-23.md
@docs/ecm/ecm-crm-phase3-plan-2026-10-23.md
@docs/ecm/ecm-crm-feature-gaps-2026-10-22.md

## Keeping this current
After each merged PR, update the "Where things stand" section. When Josh answers a decision, move it out of "Open decisions" and record the answer here.
