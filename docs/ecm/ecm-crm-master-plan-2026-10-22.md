# ECM CRM master plan (2026-10-22)

Built from reading the repo on main after PRs #37 to #43 merged. It corrects the earlier gap list (`ecm-crm-feature-gaps-2026-10-22.md`), which was written before I had checked the code and called some existing features missing.

## Corrections to the earlier gap list
- Owner emails already exist for web leads, survey responses and referrals (`lib/notify-owner.ts`). What is missing is owner alerts for money events: estimate approved, contract signed, invoice paid.
- A Stripe payment-link builder exists (`lib/payment-links.ts`) but only the AI assistant can use it. There is no button in the CRM.
- Route optimization exists (`/api/dispatch/optimize`, used on the Jobs page). There is no calendar or drag-and-drop dispatch.
- A post-job survey with a Google review link exists (email cron). There is no text-message review request, and no reminder if they ignore it.
- `job-reminders` cron exists but is not in `vercel.json`, so it never runs. It emails only the owner, 45 to 75 minutes before a job. The customer-facing `appointment-reminders` cron is scheduled (daily).

## What the code shows is the real hole: the work loop is not closed
Lead, estimate, contract, job, complete, **invoice**, **paid**, review. Each step exists, but the hand-offs between them are manual:

| Hand-off | State today |
|---|---|
| Lead to estimate | Manual. Lead stage is a status dropdown only. |
| Estimate approved to contract | Contract can prefill from an estimate (`fromDocumentId`). Not automatic, no alert. |
| Contract signed to job | Manual "Schedule job" button (shipped #33). |
| Contract signed to maintenance plan | Automatic since #41. |
| Job complete to invoice | **No path.** Nothing creates an invoice from a finished job. |
| Invoice sent to paid | Stripe webhook marks paid. **No owner alert**, no payment link button. |
| Paid/complete to review | Email survey 1 day later. No text, no follow-up. |
| Maintenance plan to visits | Renewal billing exists. **No scheduled visits** from a plan. |

Closing this loop is worth more than any new module, so it comes first.

## Phases

### Phase 1: close the money loop (biggest payoff)
1. **Owner alerts** for estimate approved, contract signed, invoice paid, job completed (email now, text if you want). Hook points: portal approve/sign actions, Stripe webhook, `job-lifecycle`.
2. **Invoice from a completed job**: "Create invoice" on a finished job, prefilled with the customer, property, job notes and the contract/estimate line items; balance = total minus deposits paid (50/50 default). Send from the CRM.
3. **Pay-now button** on invoices and sent documents using the existing `createInvoicePaymentLink`; shown to office, copy/text link.
4. **Deposit tracking**: show deposit paid / balance due on the contract and job, so the 50% completion payment is a visible to-do.

### Phase 2: make the truck app complete for a tech
5. **Job screen for the tech**: customer notes, property **access notes** (column exists since #43, not yet shown on the truck card), equipment on file with history, last service, photos.
6. **Service-call report** for repairs (install report and PM checklists exist; repairs have nothing): symptoms, readings, work done, parts used, labor time, customer signature, then a one-tap invoice.
7. **Parts used on a job** deducting from inventory (inventory exists but is office-only and not tied to jobs).
8. **Tech account page**: change own password (techs cannot today).
9. **Tech time**: `tracked_hours` column exists; capture it from arrived/complete automatically and expose weekly totals for payroll.

### Phase 3: scheduling and recurring revenue
10. **Dispatch calendar** (day/week by tech) on top of the existing jobs and the assigned-tech field.
11. **Recurring maintenance visits** generated from active plans (annual tune-up auto-scheduled, customer reminded). Plans now exist reliably (#41).
12. **Schedule `job-reminders`** and extend it to the customer and the assigned tech (needs a Vercel plan check for frequent crons; otherwise a daily morning digest).

### Phase 4: sales and reputation
13. **Lead pipeline board** (new, quoted, won, lost) with source, next step and follow-up date; leads table exists.
14. **Good / better / best estimates** using the existing price-book tiers.
15. **Text review request** after payment with the Google review link, plus one reminder; stop if they already responded.
16. **Seasonal / lapsed-customer campaigns** (tune-up reminders, equipment age) once consent flags are confirmed (sms_optins exists).

### Phase 5: hardening and reporting
17. Private photo buckets with signed links (still public after the lockdown).
18. Rate limit OAuth registration; narrow Field Board secrets.
19. Tests on the money paths (contract signing, renewal cron, invoice totals); `@ts-nocheck` still in `estimate-routing.test.ts`.
20. Reports: profit per job, revenue by service type, lead source results, tech hours.
21. Payroll/time export; optional push to Square.

## Order I recommend
1, 2, 3, 4, then 5, 6, 8, then 10, 11, 12, then 13, 15, then the rest. Each is one PR, preview, you test, "merge N". Items that need a database column ship with the SQL for you to run, since the tool will not run production migrations.

## Decisions I need from Josh (none block Phase 1)
- Owner alerts by email only, or email plus text to your phone?
- Invoices: keep creating them in the CRM and sending the Stripe link, or keep using Square invoices for some jobs? (Affects item 2 and 3 wording only.)
- Does the tech need to see prices, or only the job and checklist? (Affects items 5 to 7.)
