# ECM CRM master plan v2 (2026-11-05)

Replaces the order in `ecm-crm-master-plan-2026-10-22.md` for everything not yet built. Built from a fresh read of `main` (migrations through 0053), competitor research and Gusto/Stripe research done 2026-11-05. Items marked UNVERIFIED could not be confirmed from an official source; check before spending money on them. Trust the code over this doc.

## The goal
Jobs get dispatched to the right tech and the tech is told. The tech clocks a full day (feeds Gusto payroll) and each job gets its own billable time. Every job has a basic checklist, notes and photos. A finished job turns into an invoice that Stripe collects, 50% deposit and 50% on completion. Nothing about money is visible to techs, and nothing a tech taps can change a job they do not own.

## Decision: stay custom, buy only the gaps
Competitor research (Jobber, Housecall Pro, Workiz, ServiceTitan, FieldEdge) says the time clock, checklists, photos, dispatch and reminders you need already exist here or are small builds. Their own payments would pull you off Stripe and they would duplicate customer and job records. Realistic cost of a product at your size is about $150 to $300 a month (Jobber Grow or Housecall Pro Max, official prices); ServiceTitan and FieldEdge are overkill (third-party estimates, unverified). Revisit only if you decide you do not want to maintain an app. What a product does better today is GPS and offline polish.

## What exists (read from code)
- Per-job stamps only: `on_way_at`, `arrived_at`, `completed_at`, one `tracked_hours` number per job (`lib/job-lifecycle.ts`). `/hours` shows weekly totals per tech.
- Notes: one text column `jobs.notes` plus `field_board_events`, mirrored to the Teams Job Notes channel.
- Photos: private `job-photos` bucket, `jobs.photos` jsonb with phase (arrival, during, completion). Signed URLs.
- Checklists: PM templates (residential/commercial), install report (multi-unit), diagnostics. No generic per-job checklist and nothing ties a template to `job_type`.
- Dispatch: `/dispatch` board, customer notices, 7:00 ET email digest to each tech and Josh.
- Money: Stripe checkout links for the full total, webhook checks signature, paid status and amount, one idempotent `markDocumentPaid`. Square sync no longer un-pays. Deposits are recorded by hand (0052).
- Two external Grok-built apps are referenced (`ecm-field.grok.me`, `branch-valley-tango-sand.grok.me`). The README says nothing calls ecm-field yet. The in-repo truck screen at `/field-board` is the real tech app.

## Problems found that come before new features
1. **A tech can change any job.** `updateJobStatus`, `addJobPhotos`, `markOnWay`, `createServiceCall` and all five `field-board` truck actions have no role or ownership check. Verified for `updateJobStatus`: it takes any status from the form and applies it. Also unguarded: `diagnostics/new` (can send the price book into the AI prompt), `documents/inbox`, `tasks`, install-report actions.
2. **Assigning a job tells the tech nothing.** `assignJob` and `rescheduleJobAt` notify the customer only. The tech finds out at the next 7:00 digest. Same-day jobs are never announced.
3. **Hours are one number per job.** It is computed once, skipped if the job was already completed, cannot cover a second visit or a second tech, and a forgotten Finish gives a huge number or none. If Arrived is never tapped it includes the drive.
4. **Stripe has no live webhook secret in Vercel.** The endpoint was created 2026-11-05; the signing secret still has to be saved in Vercel and production redeployed. Until then paid invoices will not mark paid.
5. **Stripe gaps:** link charges the full total only (no 50/50 links), no handling of refunds, disputes, failed or partial payments, amount mismatches only log to the console, webhook event ids are not stored.
6. **Photos and notes can lose data** under concurrent writes (read-modify-write on jsonb and a text blob). Large phone photos can hit the 4.5MB body limit.
7. **One field-board bearer accepts four different secrets** (field board, app key, cron, MCP). A leak of any opens the field API.
8. **Scale:** no `loading.tsx`, few indexes (nothing on `jobs(scheduled_at)`, `jobs(status)`, `jobs(customer_id)`), crons loop per row and send emails one at a time, `email-reminders` runs seven jobs in one `Promise.all`. No tests on job-lifecycle, `markDocumentPaid`, the Stripe webhook or Square sync.

## Time: the design
Two separate things, kept separate on purpose.

**A. Full-day clock for payroll (Gusto).** Gusto's own Time Tracking (needs Plus or Premium) has iOS and Android apps, clock in/out with GPS at clock-in, project tracking, manager approval, and approved hours flow to payroll. Gusto's push API for custom apps (`time_tracking/time_sheets`) is documented for partners with an OAuth app; whether a single company can get production access is UNVERIFIED. Recommendation: use Gusto's own clock for the day. Ask Gusto developer support whether a private integration is allowed; if yes, a later PR can push CRM shifts. Do not build a second payroll clock that someone has to re-enter. Prices seen: Plus $80/month plus $12 per person (Gusto page, confirm on the plan page); geofencing and overtime auto-flagging UNVERIFIED, test during trial. Fallback if the Gusto app is too weak in the field: QuickBooks Time Elite or Homebase, only after confirming their Gusto sync in a trial.

**B. Per-job billable time (CRM).** New `job_time_entries` (staff, job, started, ended, kind work or drive, note, source). On my way, Arrived, Finish and a Pause/Resume button write entries. Supports several visits and several techs per job. Forgotten stops are auto-closed at a cap and flagged for office review instead of silently producing a wrong number. `tracked_hours` becomes the sum of entries. Office-only report compares each tech's job hours with their Gusto day, so drive and shop time are visible. Overtime math stays in Gusto.

Massachusetts notes (Mass.gov wage and hour guide, 2016 PDF, check for a newer version): overtime at 1.5x over 40 hours a week; 30-minute meal break for shifts over 6 hours, unpaid only if the employee is free of duties; weekly or biweekly pay; paystubs show hours and rate. Record retention period not confirmed; ask the accountant.

## Phases (one PR each, SQL shipped for Josh to run)

### Phase 0: stop the bleeding (this week)
1. Finish Stripe setup: save webhook secret, redeploy, test payment and refund. (Josh action plus a check by me.)
2. Merge #89 after Josh runs 0054 and tests.
3. **Tech role hardening** (S to M, no SQL): `requireRole` and ownership checks inside every truck, jobs, diagnostics, install and task action; allowed status transitions only; tech may only touch jobs assigned to them. Tests.
4. **Tell the tech** (S, no SQL): email on assign, reschedule and cancel. Text and push in Phase 2.
5. Narrow the field-board secret to its own key (S).

### Phase 1: Stripe and invoices tight
6. Import customers and the 12 open Square invoices into Stripe (reviewed list first).
7. **Invoice from a completed job** in one tap: labor from time entries, parts from the report, prefilled from contract or estimate.
8. **50/50 links:** deposit link at approval and balance link at completion, reconciling to `deposit_received_cents`.
9. Webhook: `charge.refunded`, `invoice.paid`, failed payments, partial amounts, stored event ids, owner alert on any mismatch.
10. Turn on ACH and the customer portal; saved card or ACH for maintenance renewals.
11. Retire Square sync once Josh confirms he is off Square.
Stripe prices (official pages): cards 2.9% + 30c, ACH 0.8% capped at $5, Invoicing Starter 0.4% per paid invoice (Plus 0.5% adds Quotes, skip it), Tap to Pay 2.7% + 5c. Tap to Pay phone requirements UNVERIFIED. Tax: do not turn on Stripe Tax or set rates until the accountant says what is taxable.

### Phase 2: the tech's day
12. `job_time_entries` and the new Arrived/Finish/Pause flow, forgotten-stop flags, rebuilt `/hours`, comparison report (M, SQL).
13. **Generic job checklist** (M, SQL): a short default list per job type (service, install, maintenance) attached automatically when the job is created; required items and at least one photo gate Finish with an office override. PM and install report stay as add-ons.
14. **`job_notes` table** (S to M, SQL): author, time, internal or customer-visible, optional link to a time entry. Teams mirror stays.
15. **`job_photos` table**, client-side resize, retry queue, author per photo, atomic insert (M, SQL; migrate existing jsonb).
16. Tech text and push: `staff.phone` column, PWA install and web push for assignment changes (M, SQL).

### Phase 3: scale and safety
17. Indexes, `loading.tsx`, batch the per-row crons, split the `Promise.all`, tests on job-lifecycle, `markDocumentPaid`, webhook (S to M).
18. Consolidate the two Grok-built apps into the in-repo truck screen or retire them.
19. Stale items: `CLAUDE.md` says photo buckets are still public (0030 made them private; verify the storage policy against 0045), 26 old branches, `@ts-nocheck` in `estimate-routing.test.ts`, shared Basic-auth login.

### Phase 4: sales and reputation (unchanged from before)
Lead pipeline board, good/better/best estimates, text review requests with one reminder, seasonal and lapsed-customer campaigns once consent is confirmed.

## What to buy or sign up for
- Gusto Time Tracking (Plus or higher): likely yes; confirm plan price and run a trial for field use.
- Stripe: nothing to buy now; ACH and the portal are free to turn on. Tap to Pay only if techs collect on site.
- Accounting (QuickBooks or Xero): ask the accountant; Gusto and Stripe both sync to it. Price UNVERIFIED.
- A field-service product: not recommended.

## Decisions I need from Josh
1. Gusto's own clock for the full day (recommended) or a different clock app?
2. Should a tech be able to finish a job with an incomplete checklist, or only with office override?
3. Text techs on assignment changes (needs phone numbers) or email now and push later?
4. Fully off Square? Then Phase 1 step 11 retires the sync.
5. Which comes first after Phase 0: Stripe invoices (Phase 1) or the tech's day (Phase 2)?
