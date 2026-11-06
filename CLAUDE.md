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
- Stage 1 follow-ups merged: #109 any text containing the word "stop" is an opt-out. #110 `confirmPendingAction` claims the token atomically before running, so two simultaneous confirms cannot both run. Stage 2: #111 plan renewal and warranty alert crons read customer relations with `one()` (they would have skipped every customer), moved to `lib/plan-renewal.ts` and `lib/warranty-alerts.ts` with tests. #112 tests for the Stripe webhook. #114 loading screens (`loading.tsx` with `PageSkeleton`) on dashboard, jobs and documents. #115 Schedule job on a contract shows errors inline and keeps the typed date (React 19 clears uncontrolled fields after an action, so an action that returns `{ error }` must echo the typed value). #116 tests for Create invoice on a finished job. Inline errors: #122 `assignJob` merged (work is in `assignJobToStaff`, shared with dispatch). `rescheduleJobAt` and `rescheduleJob` return `{ error }` in the reschedule PR (production builds hide a thrown server action's message). #124 merged. #130 merged: `updateJobStatus` returns `{ error }` (Jobs list status Save, Field Board I'm here via `ArriveForm`, Finish, assistant). #131 merged: + New Service Call via `NewServiceCallForm`. Pattern for new actions: return `{ error }`, never throw for expected problems.
- New York time fixes, all merged: #126 `rescheduleJob` keeps the job's New York time when moving days (`moveToEtDate` in `lib/tz.ts`; before, an evening job moved on the jobs list landed a day early and a job with no time landed at 4 AM ET). The assistant's `reschedule_job` goes through `rescheduleJobAt` (`etLocalFromIso`: no zone means New York time); before, it always failed. Booking form fixed in #127 (`etDateAtHour` in `lib/tz.ts`; owner web-lead email now prints New York time). Portal request-service fixed in #128. Route optimizer fixed in #129 (it likely never reordered a route before): New York day and slots (`lib/route-slots.ts`), address read with `one()` (it always said "fewer than 2 stops"), moves go through `rescheduleJobAt` so customers get the normal schedule notice, `requireOffice` inside the route. Website chat booking (`lib/receptionist/web-tools.ts`) fixed in the PR after #131 (`parseEtLocal`). Still open: the phone receptionist availability + booking (`lib/receptionist/tools.ts`) build times with `new Date(y, m, d, h)` on the UTC server clock; the website chat uses the same availability check.
- #120 status update merged. #121 merged: npm audit critical/high fixed (next 16.4.5, vitest 5.1.0, sharp 0.35.5, zod 4.6.7, MCP SDK 1.32.2, mcp-handler 2.3.1, `@types/node` ^22). 8 moderate left in typescript-eslint/minimatch (no fix short of downgrading eslint-config-next). Dependabot majors still open: #76 TypeScript 7, #77 Stripe 23, #78 `@anthropic-ai/sdk` 1.x.
- Phase 4 started: #119 text review requests (merged, SQL 0060 run: `jobs.review_request_sent_at`, `review_reminder_sent_at`). Daily cron `review-requests` at 16:00 UTC texts the survey link 1 day after the balance invoice is paid (or after finish if no live invoice), one reminder 5 days later, only with phone, `sms_consent` and `canText`, and stops once the survey is answered. Customers who can be texted no longer get the email follow-up (it only goes to people we cannot text). Needs `GOOGLE_REVIEW_URL` on Vercel for the Google link. #117 status update merged.
- #103 tech web push alerts merged 2026-11-06 (SQL 0057 run; all 4 VAPID keys set on Vercel production; `VAPID_PUBLIC_KEY` is not set for Preview, so push does not send on previews). #127 to #131 merged and deployed 2026-11-06. Open: #89 customer book-my-visit link. #92 and #93 are plan docs.
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
- Checked 2026-11-06: `STRIPE_WEBHOOK_SECRET` (since 7/20) and `GOOGLE_REVIEW_URL` (since 7/24) are set on Vercel production. Not yet proven against the current Stripe endpoint: test with one small payment.
- Still to do on his side: check the Gusto import column names against the hours file, ask Gusto about API access.

## After Phase 3
- Phase 4: lead pipeline board, good/better/best estimates, seasonal/lapsed-customer campaigns once consent is confirmed.
- Phase 5: OAuth registration rate limit, narrow Field Board secrets, tests on money paths (contract terms, renewal cron, invoice totals), reports, payroll/time export, optional push to Square.

## Known open issues from the 2026-10-21 audit (not yet fixed unless listed above)
Some audit items were fixed after the audit. Re-check each one in code before working on it.
- Fixed: `Bearer undefined`. `lib/bearer-auth.ts` (fail-closed, timing-safe) and `lib/cron-auth.ts` exist (#20, #24). Admin routes and `copilot/agent` use `bearerAuthorized`. `copilot-actions/[action]` now uses `tokenMatches` too (#106).
- Fixed: New York time helper is `lib/tz.ts`; reminder crons use it.
- Fixed: renewal cron charges `renewal_price_cents` and rolls `end_date` forward one year.
- Fixed (#105): `/api/internal-chat` destructive tools. Techs are blocked, office gets none, owner needs propose then confirm.
- Fixed (#110): `confirmPendingAction` claims the token before running.
- Fixed: Stripe webhook checks `payment_status` and amount, and `markDocumentPaid` is idempotent (tests in #112). Square sync un-paying a Stripe-paid invoice: re-check `square-sync.ts` before working on it.
- Fixed in the #81 PR: customer appointment reminders read the customer relation as an array, so the first job with consent would have been skipped. 0 sent so far because no scheduled job has had a customer with phone + `sms_consent`. Use `one()` from `lib/appointment-reminder.ts` for Supabase relations.
- Fixed (#107): SMS STOP/START tables and `canText` on every customer text; senders already return honest results. Fixed (#109): any text with the word stop is an opt-out. Still open: `customers.sms_consent` defaults to true (Josh's call).
- Partly fixed: `loading.tsx` exists for dashboard, jobs and documents (#114). Most actions still throw instead of returning inline errors (#115 did Schedule job).
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
