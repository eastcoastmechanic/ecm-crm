# ECM CRM master plan v3 and platform report (2026-11-05)

Replaces v2 (PR #92) and the order in the 2026-10-22 master plan for everything not yet built. Built from a read of `main` (migrations through 0053) and vendor research done 2026-11-05 from official pages. Items marked UNVERIFIED or NOT FOUND could not be confirmed; check before spending money. Trust the code over this doc.

## 1. Josh's answers (2026-11-05)
1. **Clock:** wants Gusto's own clock inside the Field Board or CRM: clock in for the day, see jobs, clock out, sent to Gusto by webhook.
2. **Checklist:** a tech cannot finish a job with an incomplete checklist. Hard gate.
3. **Tech notices:** use Microsoft Teams (chat or job notes). Jobs already have folders in Teams.
4. **Square:** not fully off. No payments through Square, no new Square invoices. Everything must be imported into the CRM.
5. **Research:** full report on Podium and other platforms, what to do and how, to make this the best CRM. Josh will pay for better tools.
6. Not yet answered: what comes first after Phase 0, Stripe invoices or the tech's day.

## 2. Reality checks on those answers
**Gusto clock by webhook.** Gusto's Time Tracking API (`time_tracking/time_sheets`) is partner-only (App Integration and Embedded Payroll partners). A single company cannot register its own app against its own account (Gusto CLI/MCP not checked, UNVERIFIED). Even for partners, an admin still syncs hours to payroll. So "CRM clock sends a webhook to Gusto" is not buildable today. Two routes:
- **Route A (recommended to start): CRM clock + weekly Gusto import file.** CRM holds a full-day shift (clock in, breaks, clock out) next to per-job entries. Weekly export is a file for Gusto Smart Import (Pay > Run payroll > Import payroll data; csv/xls/xlsx; template headers UNVERIFIED, test with one pay period). Techs use one app. One manual upload per payroll.
- **Route B: Gusto's own clock app (Plus or Premium)** or a Gusto-integrated clock (QuickBooks Time, Homebase, Connecteam, Timeero, ClockShark, Deputy). Hours flow to payroll with no upload, but techs use a second app and per-job time still lives in the CRM. Plus about $80/month + $12/person (UNVERIFIED, confirm on Gusto's plan page).
- **Ask Gusto support in writing** whether a private integration for one company is allowed. If yes, Route A upgrades to a real push later with no rebuild, because shifts are already stored.
- Do not build both clocks. Pick one source of truth for the day.

**Teams.** Code today posts Adaptive Cards to Power Automate Workflows webhooks (`lib/teams.ts`, channels DISPATCH, GENERAL, JOB_NOTES, MONEY, ...). No SharePoint/OneDrive job folders exist in code, no @mention, no DM. App-only Graph cannot send normal chat messages. A Workflows webhook posts to one fixed chat or channel; @mention by UPN may work (untested). Real per-tech DMs or activity-feed alerts need a custom Teams app. Mobile push for mentions is UNVERIFIED.
- Plan: post each assignment, reschedule and cancel to the Dispatch channel with the tech named, and test @mention on a phone. Keep the email as the backup so nothing depends on Teams alone.
- **Need from Josh:** where are the job folders (which Team, SharePoint site or library, naming)? Then the CRM can store the folder link on the job and post notes there.
- A tech needs a Teams account on a phone for any of this. Text is the fallback (needs `staff.phone`).

**Hard checklist gate.** The Finish action refuses while any required item is open or no photo exists. Gate lives in the server action, not only the button. Josh said no override. My suggestion, for him to confirm: an owner-only unlock that records who and why, because a broken phone or a customer who will not wait will happen. Without it, a stuck job needs a SQL fix.

**Square.** Square becomes a read-only archive. CRM already imports invoices (`square_invoices`) and payments (366-day window, 50-page cap). Not imported: estimates, line items, refunds, catalog, customer list, payments older than 366 days. Square MCP showed 57 invoices Nov 2025 to Oct 2026 (40 paid, 9 unpaid, 3 partial, 3 canceled, 1 refunded, 1 failed). The CRM also still creates Square customers, orders and draft invoices from `documents/inbox` (`routeToSquare`); turn that off once Josh agrees. Sync stays read-only and never downgrades `paid`.

## 3. What exists today (read from code)
- Per-job stamps only: `on_way_at`, `arrived_at`, `completed_at`, one `tracked_hours`. No shift clock, no time-entries table, no Gusto export.
- Notes: `jobs.notes` text blob plus `field_board_events`, mirrored to Teams Job Notes. Photos: private `job-photos` bucket (0030), `jobs.photos` jsonb. Checklists: PM, install report, diagnostics; no generic job checklist.
- `/dispatch`, 7:00 ET email digest, maintenance visits from plans, booking reminders, self-confirm link (#89 pending).
- Stripe: Checkout link for the full total, webhook (signature, paid status, amount), idempotent `markDocumentPaid`. Webhook endpoint created; live signing secret not yet in Vercel.
- AI receptionist (SMS, voice, web), STOP/START handling, surveys with a Google review link, portal, equipment and warranty data, analytics page.

## 4. Problems to fix first
1. A tech can change any job: `updateJobStatus`, `addJobPhotos`, `markOnWay`, `createServiceCall`, all five `field-board/actions.ts`, diagnostics/new, documents/inbox, tasks, install-report actions have no role or ownership checks. `updateJobStatus` accepts any status.
2. Assigning or rescheduling tells the customer, not the tech.
3. Hours: one number per job, computed once, wrong if Arrived or Finish is forgotten.
4. Stripe: webhook secret not saved in Vercel, so paid invoices will not mark paid. Gaps: full-total link only, no refund/dispute/failed handling, mismatches only log, no event ids stored.
5. Photos/notes can lose data under concurrent writes; big phone photos can hit the 4.5MB body limit.
6. One field-board bearer accepts four secrets.
7. Scale: no `loading.tsx`, few indexes, per-row crons, `email-reminders` one `Promise.all`, no tests on job-lifecycle, `markDocumentPaid`, webhook, Square sync.

## 5. Platform due diligence
Official pages only, fetched 2026-11-05. Many pages blocked; gaps stated.

### Podium
No published prices (custom quote). Third-party reports about $399 to $599/month on annual auto-renew with billing complaints (unverified). Modules: Inbox (text, calls, email, social), Reviews, Phones (VoIP, missed-call text-back, recording, AI summaries), Webchat, Payments (text-to-pay, estimates, tap to pay, BNPL, next-day payout), Text Marketing, AI Employee (answers leads, qualifies, books, reminders, re-engages past customers, escalation rules), Automations ("200+ integrations"), Lead Consolidation. Field-service module: NOT FOUND. Its ServiceTitan and Housecall Pro integrations imply it sits on top of a field product, not in place of one.
**What matters for ECM:** one inbox for every customer message, missed-call text-back, text-to-pay, review requests with reminders, AI that books. ECM already has the AI receptionist, STOP/START, a survey, and Stripe links. The gap is the **single inbox** (conversations page shows AI threads only) and **text-to-pay**, both buildable. Podium is a bad fit as a second system of record; copy its ideas, do not buy it.

### Field-service platforms (official prices where found)
| Product | Price seen | What it has that ECM lacks or matches |
|---|---|---|
| Jobber | Core $29, Connect $99/$149 (5 users), Grow $149/$229, Plus $399+; AI Receptionist add-on $29 | Time and checklists on Connect+, Wisetack on quotes, automated quote follow-ups, review triggers need Reviews add-on |
| Housecall Pro | Basic $59/$79, Essentials $149/$189, Max $299/$329 | Checklist automations (Essentials), recurring plans and open API (Max), AI CSR (add-on, price NOT FOUND) |
| Workiz | Hidden | Service plans, checklists, API on Ultimate; AI answering with rules (after-hours only, or only if dispatch has not answered in 10 minutes) |
| ServiceTitan | Per tech, no prices | AI agents, Follow-Ups, Second Chance Leads, memberships top tier. Overkill |
| FieldEdge | No prices | Multi-option quotes in Premier. Overkill |
| Service Fusion | $245/$382/$627 | Up to 5 estimate options, AI call answering add-on, outbound AI calls for estimates, renewals, unpaid |
| GorillaDesk | Per route | Pest/lawn; not a fit |
| Successware | No prices | BookIt booking widget, lead source on calls, callback tracking |

Read: ECM already matches recurring plans, dispatch and customer reminders. Behind on: generic checklists, shift time, good/better/best quotes, quote follow-up, text-to-pay, one inbox, financing, offline polish. A paid product runs about $150 to $300/month and would duplicate customers, jobs and money. **Stay custom.**

### Add-on tools (official pages)
- **Quo** (phone and texting): Starter $19, Business $33, Scale $47 per user monthly ($15/$23/$35 billed yearly). API and webhooks on every plan, Zapier, Make. Missed-call auto-reply text (one per contact per 3 hours). Auto recording on Business and up. Your Quo connector already reads calls, transcripts, messages, contacts. Webhook event types: NOT FOUND.
- **Twilio:** SMS $0.0083 per segment plus carrier fees (about $0.0035 to $0.005); long code $1.15/month, toll-free $2.15. Voice prices NOT FOUND.
- **AI answering:** Goodcall $79/$129/$299 per month (about 150/750/3,000 calls; API, MCP, Zapier; webhooks not mentioned). Smith.ai human-first $300/$810/$2,100 per month by call count. Ruby $250 to $1,725 by minutes. Jobber AI Receptionist $29 add-on (from Jobber's page). Housecall Pro CSR AI add-on only if you run Housecall Pro.
- **Financing:** Wisetack: APR 0% to 29.9%, 3 to 60 months, up to 6 options, contractor paid on completion, customer repays Wisetack. Merchant fee and integration method NOT FOUND. Ask Wisetack how a custom CRM connects.
- **Reviews:** Birdeye custom pricing (multi-site); NiceJob and Grade.us pages blocked. Text invite plus one reminder to the Google link is a small build here.
- **Lead capture:** Google Local Services Ads lead flow NOT FOUND from Google. ServiceTitan's doc shows the pattern (lead capture, auto-reply, Google tracking number, Early Access). Check Google directly before building.
- **Massachusetts recording:** M.G.L. c.272 §99 treats recording without all parties' prior authority as interception (all-party consent). Any AI or answering-service recording needs a spoken disclosure up front. Not legal advice; confirm with a lawyer.
- **Stripe** (official): cards 2.9% + 30c, ACH 0.8% capped $5, Invoicing Starter 0.4% per paid invoice (Plus 0.5% adds Quotes, skip), Tap to Pay 2.7% + 5c.

## 6. Build vs buy
**Build in the CRM:** shift clock and per-job time, generic checklist with gate, job notes and photos tables, tech notices, Stripe invoices from jobs with 50/50 links, one inbox, text-to-pay, text review requests, quote follow-ups, good/better/best quotes, reports, Square archive import.
**Buy or sign up for:** Gusto Time Tracking only if Route B; Quo (Business, per user, about $23 to $33) for the business phone, missed-call text-back and call logs into the CRM; Wisetack (free to set up, fee to confirm) for financing; an AI answering service only after the CRM inbox exists, and only with a recording disclosure.
**Do not buy:** Podium, a full field-service product, Stripe Quotes (Plus).

## 7. Phases (one PR each, SQL shipped for Josh to run, "merge N" only after his test)

### Phase 0: stop the bleeding
1. Josh: save Stripe signing secret in Vercel `STRIPE_WEBHOOK_SECRET`, redeploy; I test a payment and refund.
2. Josh: run 0054, test #89, "merge 89". "merge 92" or this PR for docs.
3. **Tech lockdown** (no SQL): `requireRole` and ownership on every truck, jobs, diagnostics, install and task action; allowed status transitions only; tests.
4. **Tech assignment notice** (no SQL): Teams Dispatch post naming the tech plus email, on assign, reschedule, cancel.
5. Narrow the field-board secret to its own key.

### Phase 1: the tech's day
6. `job_time_entries` + `time_shifts` (SQL): clock in for the day, job entries, breaks, auto-close at a cap, office review flags, rebuilt `/hours`, **Gusto export file** (Route A).
7. **Generic checklist** (SQL): default list per job type attached on creation, required items and one photo gate Finish on the server.
8. `job_notes` table (SQL); store Teams folder link on the job.
9. `job_photos` table (SQL), client-side resize, retry queue, author per photo.

### Phase 2: Stripe and invoices tight
10. Import customers and 12 open Square invoices into Stripe (reviewed list first).
11. Invoice from a completed job: labor from time entries, parts from the report.
12. 50/50 links reconciling to `deposit_received_cents`.
13. Webhook: refunds, disputes, failed and partial payments, stored event ids, owner alert on mismatch. ACH and customer portal.
14. **Square archive import** (SQL): invoices, payments beyond 366 days, customers, line items, refunds, estimates; disable `routeToSquare`; keep sync read-only.

### Phase 3: the best CRM
15. One inbox: all texts, calls (via Quo webhooks), email, web chat per customer, with timeline.
16. Text-to-pay from the inbox; text review requests with one reminder; quote follow-ups.
17. Good/better/best estimates; Wisetack financing link once its integration is confirmed.
18. Lead pipeline board; lead source; seasonal and lapsed-customer campaigns (consent only).
19. Reports: profit per job, tech hours vs Gusto day, revenue by service, plan renewals.

### Phase 4: scale and safety
20. Indexes, `loading.tsx`, batch crons, split `Promise.all`, tests on job-lifecycle, `markDocumentPaid`, webhook, Square sync.
21. Retire or fold in the two Grok-built apps; stale CLAUDE.md notes (photo buckets are private since 0030); 26 old branches; `@ts-nocheck`; shared Basic-auth login.

## 8. SQL Josh will be asked to run
0054 (pending), then in order: time shifts and entries, checklists, job notes, job photos, `staff.phone` (if text), Square archive tables. Each ships as a file; none run without him.

## 9. Decisions still needed
1. Order after Phase 0: Stripe invoices (Phase 2) or the tech's day (Phase 1). I recommend the tech's day: busy season, and invoices then pull real labor hours.
2. Gusto: Route A (CRM clock plus weekly file) or Route B (Gusto's clock app)? Ask Gusto support about private integrations either way.
3. Owner unlock on the checklist gate, with a logged reason: yes or no.
4. Where the Teams job folders live; do techs have Teams on their phones; text as backup (needs phone numbers)?
5. Turn off Square draft/customer creation from the CRM now?
6. Quo as the business phone? Wisetack financing?
7. Also open: head office address in Stripe tax settings; DOR withholding account name; accountant on sales tax.

## 10. Decided by Josh (2026-11-05, later that morning)
1. **Order:** the tech's day first (Phase 1), Stripe invoices after.
2. **Gusto, one app for techs (replaces Route B):** the CRM Field Board is the only app a tech uses. Clock in for the day, jobs, per-job On my way / Arrived / Finish, clock out. Hours go to Gusto as a file for its payroll import once per pay period (Route A), with regular and overtime (over 40 a week) split by the CRM; whether Gusto accepts that split is tested with one real pay period. Ask Gusto support in writing whether a single company can get Time Tracking API access; if yes, the file becomes an automatic push. The CRM prompts the 30-minute break on shifts over 6 hours.
3. **Checklist gate:** hard gate on Finish, with an owner-only unlock that records who and why.
4. **Teams folders:** live in SharePoint site `ecmjobs`, Shared Documents / Job Notes / one folder per job address (for example "<street> <town>"), with subfolders such as Equipment and Scope. Teams Job Notes channel Files tab shows the same folders. Read from the Microsoft 365 connector 2026-11-05; the Teams list call needs a scope not granted, so channel layout is unchecked.
5. **Square:** stop the CRM creating Square customers, orders and draft invoices (`routeToSquare`). Square becomes a read-only archive.
6. **Quo:** already signed in and in use. Not a purchase. CRM work is to connect it (calls, texts, missed-call text-back into the inbox).
7. Still open: Wisetack financing, Teams phone use by techs, `staff.phone`.
8. **Tech notices, one app:** alerts for assign, reschedule and cancel arrive inside the Field Board (installed to the phone's home screen, web push). Teams post (Dispatch channel, naming the tech) stays as the office record, and the job card links to the job's Teams Files folder. Email stays as backup. (Josh said the plan is "much" better; his message was cut off, so confirm if he meant otherwise.)
9. **Folders:** Teams Job Notes channel, Files tab, is the SharePoint `ecmjobs` library underneath. Same folders.
