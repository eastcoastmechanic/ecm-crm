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

## Where things stand (as of 2026-11-05, verify with `gh pr list`)
- Phase 1 (owner alerts, job billing line, payment link, deposit tracking) merged: #44 to #47.
- Phase 2 (truck app for techs: job card details, tech account page, service report access, install report access, inventory deduction, tech hours) merged: #48 to #52.
- #53 (inventory double-deduction fix) merged.
- #54 (CLAUDE.md and docs/ecm reference docs) merged.
- #55 (status update) and #56 (PR template, Dependabot config) merged. Branch protection on `main` (PR + `check` + `Vercel` required), Dependabot security updates on.
- Phase 3: #58 done (#80, 7:00 ET digest). Teams alerts merged (#83 money and finished jobs, #84 field notes to Job Notes). #59 `/dispatch` calendar merged (#85). #60 merged in two parts: part 1 (#86, SQL 0053 run) plans carry `visit_months` (default April and October), a daily cron makes each visit and an unscheduled maintenance job, dispatch lists them under Needs scheduling, dashboard counts overdue ones; part 2 (#88) daily 15:00 UTC booking reminder, one follow-up after 7 days (my choice, Josh has not set it), text only with `sms_consent`, email to anyone with an address. #61 (self-confirm link) is built in #89, still open and not merged (SQL 0054 is already run in the database). #82 (appointment reminder relation fix) merged.
- Tech's day, Phase 0/1 (Josh's plan v3, 2026-11-05), all merged: #94 tech lockdown (role and ownership checks on job and truck actions), #95 tech assignment alerts (email plus Teams Dispatch), #96 field board API accepts only its own keys (a bot using the cron or MCP key there is now cut off; Josh has not confirmed none does), #97 time clock part 1 (day shift and job timers, pause and resume, SQL 0055 run), #98 time clock part 2 (hours report, flagged time, weekly payroll file for Gusto), #99 job checklist with hard Finish gate and owner unlock that logs who and why (SQL 0056 run, starter checklist wording is placeholder and Josh edits `job_checklist_templates`), #100 Job files button to the Teams Job Notes Files tab (`TEAMS_JOB_FILES_URL` overrides, `off` hides).
- Stripe/Square: #101 merged, Create invoice on a finished job (amount prefilled with contract total less deposit received, SQL 0058 run, one live balance invoice per job). #102 merged, Square is a read-only archive (the CRM refuses Square writes unless `SQUARE_WRITES_ENABLED=true`; owner-only import of Square customers on /payments; imported customers get `sms_consent=false`). Old Square invoices are not turned into CRM documents; the sync already stores the last year in `square_invoices`/`square_payments`.
- Stage 1 security fixes (2026-11-05), all merged: #105 chat assistant and Teams/Copilot agent: deletes and customer sends go propose then `confirm_action`, never confirmed in the same turn (owner only; card charges stay MCP-only). #106 `copilot-actions` key check is timing-safe and fails closed (that connector only exposes a fixed safe list, no deletes or sends). #107 SMS consent: SQL 0059 run (live `sms_optins` was the old shape and `sms_excluded_numbers` was missing, so STOP and `canText` never worked); every customer text now goes through `canText`. SQL 0030 run: all six storage buckets are private (signing code in `lib/photo-urls.ts` was already live; the 21 old files in `diagnostic-photos` and `document-photos` are unreferenced test uploads).
- Open: #103 tech web push alerts (SQL 0057 run; sends nothing until Josh sets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on Vercel and redeploys). #89 customer book-my-visit link. #92 and #93 are plan docs.
- Phase 3-5 items are GitHub Issues #57 to #71 (labels `phase-3`/`phase-4`/`phase-5`, `needs-decision`). Work from "do issue N".
- Earlier merged: #41 (signed maintenance contract creates plan), #42 (multi-unit install report, migration 0050), #43 (customer/property fields, access notes, migration 0051), #33 (Schedule job button).
- Anon DB/storage policies were locked down, and the photo buckets are private now (0030).

## Phase 3 (next): scheduling and recurring revenue
Order, one PR each:
0. Done (#57). Live DB has 0 plans (`service_contracts` empty, no contract signed yet). Plans store no visit count or months; `plan_name` is hardcoded "Annual Maintenance Plan" in `app/portal/documents/[id]/actions.ts`. No maintenance jobs exist (job_type is install or service). Jobs use both `complete` and `completed` statuses; check which one lifecycle code expects.
1. (#58) Schedule `job-reminders` in `vercel.json` (check Vercel plan allows sub-daily cron; if not, one 7:00 ET morning digest to Josh and each tech). Also remind the assigned tech.
2. (#59) `/dispatch` calendar (office/owner only): day/week, column per tech plus Unassigned, click-to-edit first, drag-and-drop later. Keep the route optimizer link.
3. (#60) Recurring maintenance visits from plans: add `visits_per_year` and `visit_months` (contract, copied to plan on signing), `maintenance_visits` table (SQL for Josh), daily cron creates the next due visit as an unscheduled maintenance job, "Needs scheduling" list, customer reminder to book plus follow-up, PM checklist starts from the right template, overdue plan visits show on dashboard.
4. (#61) Optional: customer self-confirm link, lands as an owner alert.

Decided by Josh (2026-11-05): Wisetack financing is a yes. Offer "Pay monthly" on estimates and contracts (Phase 4, after Stage 1 security fixes). Fees and terms not checked yet.

Decided by Josh (2026-10-25):
- Visits per plan: 2 a year, AC tune-up in April, heating tune-up in October. Default for new contracts; editable per contract.
- Booking reminders: text and email. Text still only with `sms_consent`; without consent, email only.
- Tech reminders: one morning digest of the day's jobs (each tech their own jobs, Josh all jobs), not a text before each job. Shipped in #80 as email at 7:00 ET (`staff` has no phone column; texting techs needs a migration).

Checked by Claude: the Vercel plan allows sub-daily crons (`square-sync` already runs every 4 hours; Hobby would reject that).

Open decisions for Josh:
- Text the tech digest too? Needs a `staff.phone` column.
- Field board key: Josh was unsure whether any bot uses the cron or MCP key there. Checked 2026-11-05: `quo` and `billing` events were still arriving after #96, so nothing seen depends on the old keys. Older sources (`grok`, `crm-field`, `field-sheet`, `office`) last posted before #96. If a bot goes quiet, it needs the field-board token.
- Still to do on his side: save the Stripe webhook signing secret as `STRIPE_WEBHOOK_SECRET` on Vercel, check the Gusto import column names against the hours file, ask Gusto about API access.

## After Phase 3
- Phase 4: lead pipeline board, good/better/best estimates, text review requests (plus one reminder), seasonal/lapsed-customer campaigns once consent is confirmed.
- Phase 5: OAuth registration rate limit, narrow Field Board secrets, tests on money paths (contract terms, renewal cron, invoice totals), reports, payroll/time export, optional push to Square.

## Known open issues from the 2026-10-21 audit (not yet fixed unless listed above)
Some audit items were fixed after the audit. Re-check each one in code before working on it.
- Fixed: `Bearer undefined`. `lib/bearer-auth.ts` (fail-closed, timing-safe) and `lib/cron-auth.ts` exist (#20, #24). Admin routes and `copilot/agent` use `bearerAuthorized`. `copilot-actions/[action]` now uses `tokenMatches` too (#106).
- Fixed: New York time helper is `lib/tz.ts`; reminder crons use it.
- Fixed: renewal cron charges `renewal_price_cents` and rolls `end_date` forward one year.
- Fixed (#105): `/api/internal-chat` destructive tools. Techs are blocked, office gets none, owner needs propose then confirm.
- Still open from #105: `confirmPendingAction` marks a token used after it runs, so two simultaneous confirms could both run.
- Square sync can un-pay a Stripe-paid invoice (`square-sync.ts`); Stripe webhook lacks amount/payment_status check and idempotency.
- Fixed in the #81 PR: customer appointment reminders read the customer relation as an array, so the first job with consent would have been skipped. 0 sent so far because no scheduled job has had a customer with phone + `sms_consent`. Use `one()` from `lib/appointment-reminder.ts` for Supabase relations.
- Fixed (#107): SMS STOP/START tables and `canText` on every customer text; senders already return honest results. Still open: `customers.sms_consent` defaults to true (Josh's call), and only exact keywords count as STOP.
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
