# ECM CRM audit, 2026-10-21

Scope: whole repo on `main` plus the live Supabase project (policies, buckets, staff table; metadata only, no customer rows read). Four parallel audits (flow/design, sync/integrations, security, code health). Items marked **[verified live]** were checked against the production database; everything else is read from code. Inferences are labeled.

NOTE (2026-10-25): `lib/cron-auth.ts` referenced below does not exist in the repo. Each cron route has its own secret check. A shared helper still has to be built.

## Health snapshot
- Typecheck passes. Lint: 12 errors, 7 warnings (most are apostrophe escapes; two are real React bugs: `AppTabs.tsx:96`, `catalog/CatalogApp.tsx:274`).
- No tests, no CI. Nothing checks a PR before merge.
- 55 pages, 41 migrations, 26 branches, open PRs #22 (tech lock), #17, #16 (field board, stale since Sept), #8.
- Only one staff row exists, role `owner` **[verified live]**. No employee has their own login yet.

## P0: fix first (security and money)

1. **Anon full-access policies in production [verified live].** The public anon key can read/write/delete: `leads`, `sms_messages` (customer texts), `square_invoices`, `square_payments`, `tasks`, `purchase_orders`, `inventory_items`, `install_reports`, `refrigerant_log`, `pending_actions`, `field_board_events`, `sms_optins`, `survey_responses`. The main tables (customers, documents, jobs) do NOT have anon policies live, so that part of the code audit was too pessimistic. The app uses the service-role key for everything except sessions, so dropping these policies is safe for the app.
   Fix: one migration dropping every `to anon` policy and revoking anon table access. Effort S.
2. **Storage [verified live].** Anon has full-access policies on `job-photos`, `diagnostic-photos`, `document-attachments`. `diagnostic-photos` and `document-photos` buckets are fully public. Fix: drop the storage policies; make buckets private and sign URLs server-side. Effort S.
3. **Admin/copilot routes accept `Bearer undefined` if the secret env var is unset** (`api/admin/*`, `api/copilot/agent`). The copilot agent has delete/send/payment-link tools. Fix: shared fail-closed, timing-safe helper (like `lib/cron-auth.ts`). Effort S.
4. **Tech role is cosmetic on main** (PR #22 fixes the page level). Not covered by #22: server actions have no role check (updateDocument can mark invoices paid; deleteCustomer; sendManualReply; sendDocumentEmail), and `/api/internal-chat` has ungated destructive tools. Fix: `requireRole()` inside money/send/delete actions; gate the chat tools. Effort M.
5. **Dashboard shows Square revenue and money owed to every role.** PR #22 redirects techs away; also hide for non-owners. Effort S.
6. **Open OAuth client registration + shared password with no rate limit** (`api/oauth/register`, `authorize`). Consent-phishing and brute-force path to an MCP token. Fix: owner-only registration, real rate limit, consent screen. Effort M.

## P1: money and status correctness
7. **Square sync can un-pay a Stripe-paid invoice** (`square-sync.ts:113-130`): amount-only fallback match plus UNPAID maps to `sent`. Refund/cancel never propagate. Fix: never downgrade `paid`; record `payment_source`; one shared after-paid hook (referral, Planner, Graph). Effort M.
8. **Stripe webhook is thin** (`stripe/webhook`): no `payment_status` or amount check, replay rewrites `paid_at`. Fix: store payment intent id, idempotent update, amount check. Effort S.
9. **Off-session charges and maintenance renewals are never recorded**; renewal price hardcoded $299 and `end_date` never rolled forward, so renewals fire once per contract. Effort M.
10. **Field Board/bot status changes skip job lifecycle** (`lib/field-board.ts:160-185`): no `completed_at`, hours, Planner/Graph sync, so the survey cron never matches those jobs. Ingest is not idempotent (duplicate notes on retry) and matches customers by fuzzy name. Fix: route through `updateJobStatus`; unique `(source, external_ref)`; require `job_id` to change status. Effort S.
11. **Reminder windows and SMS times use UTC** (`appointment-reminders`, `jobs/actions.ts`): customers can be told the wrong time or reminded for the wrong day (inference: Vercel runtime is UTC). Fix: shared America/New_York helper. Effort S.
12. **SMS compliance:** STOP/START not handled; some sends skip the consent check (manual reply, lead outreach); `sms_optins` is an open table anyone can write; senders swallow HTTP errors so reminders are stamped as sent when they failed. Effort M.

## P2: flow and feel
13. **No real "new job" flow.** Only `createServiceCall` (no customer, starts in progress). Jobs show "Unknown customer". Add `/jobs/new` (customer, property, date, type) and "Schedule job" on a signed contract. Effort M.
14. **Customer page is a dead end:** no New Estimate/Contract/Job buttons; jobs are not links. Add an action bar and prefill `customer_id`. Effort S.
15. **Lifecycle gaps:** lead has no "Create estimate"; owner is not notified when a customer approves an estimate or signs a contract; no "Send payment link" button (payment-link code exists but has no UI); no "Create invoice" on job complete; no review request button. Effort S each.
16. **Form errors:** most actions throw, so any failure replaces the page with "Something went wrong" and loses input. Use an inline `{error}` pattern (as in `AddLeadModal`). No `loading.tsx` anywhere; the dashboard blocks on two Square calls. Effort M.
17. **Menu bloat:** 16 destinations; Properties/Equipment duplicate the customer page; dead `NavLinks.tsx`; inconsistent labels (Home/Dashboard, Leads/Lead Radar, Payments/Square Payments). Developer text in the UI ("Run db/migrations/0040..."). Effort S.
18. **Raw IDs and statuses in the UI** (procurement job picker shows UUIDs; `in_progress` shown raw). Effort S.

## P3: tracking, sync, hygiene
19. **Employee model:** `jobs` has no assignee; `staff` has no FK from jobs; hours are one scalar per job (`tracked_hours`, plus a second one on diagnostics) computed only on first completion. Labor rate comes from env `HOURLY_LABOR_RATE`, not a fixed $125 (verify the value). If you keep payroll in Square, push time cards from a `job_time_entries` table instead of building payroll in the CRM. Effort L.
20. **Dashboard revenue** pages all of Square history on every load and can double-count; read from `square_payments` and subtract refunds. Effort M.
21. **Square sync:** reads unpaginated (1000-row cap, inference), deleted invoices never tombstoned, no alerting on failure. Effort M.
22. **Crons:** `job-reminders` unscheduled; `email-reminders` runs seven jobs in one `Promise.all` (one throw loses all) and re-creates Planner cards daily for customers without email. Effort S.
23. **Graph/Copilot index drifts** (synced only at creation). **Dead `tasks` table** still read by the field sheet. Missing FKs (`jobs.equipment_id`, property/customer consistency); `db/schema.sql` is stale. Effort S to M.
24. **Field Board token** also accepts `CRON_SECRET` and `MCP_API_KEY`, and the 401 reveals which secrets are set. One secret per surface. Effort S.
25. **Open redirect** on `/login?redirect=` via `/\host`. **Rate limiting** is in-memory per instance; public forms (`bookService`, contact, survey) have none. Effort S to M.
26. **Quality:** add CI (tsc, lint, build) and tests for payment/deposit math (`lib/contract-terms.ts`); fix the 12 lint errors; clear 26 stale branches and old PRs.

## Suggested PR sequence (one change per PR)
1. DB migration: drop anon policies + storage policies (after one preview test of portal login).
2. Merge #22; add `requireRole` to money/send/delete actions; hide dashboard money from non-owners.
3. Fail-closed admin/copilot auth + gate chat tools.
4. Money correctness: Square/Stripe/doc status rules and webhook hardening.
5. Field Board ingest through `updateJobStatus`; New York timezone helper; SMS STOP/consent.
6. Flow: `/jobs/new`, customer action bar, owner notifications, payment-link button, inline form errors.
7. Nav cleanup and labels; CI; lint fixes; branch cleanup.
8. Employee hub: assignee on jobs, time entries, Square time-card push.

## Decisions needed from Josh
- Keep invoicing/payroll/time clock in Square (recommended) or own them in the CRM?
- Is the shared Basic-auth login still needed? Retire it once each person has a staff login.
- Create the employee's staff row (role `tech`) after #22 merges.
