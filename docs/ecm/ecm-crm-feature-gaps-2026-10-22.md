# ECM CRM: feature gaps vs Jobber / ServiceTitan / Podium / Salesforce (2026-10-22)

Written from general knowledge of those products, not from a live review of their current feature sets. Ranked for a small HVAC/plumbing shop (owner + a few techs), not an enterprise.

## What ECM CRM already has (do not rebuild)
Customers / properties / equipment, price book (catalog), estimates, contracts with e-sign and renewal consent, warranty, Mass Save rebate and assessment docs, diagnostics + PDF, install report (now multi-unit), jobs with scheduling and assignment, Field Board (on my way / arrived / complete, time on site, photos), conversations (SMS/email), maintenance plans with renewal cron, analytics, dashboard with Square numbers, customer portal, role-locked tech / office / owner access, Planner tasks, Square sync.

## Gaps, ranked (value to ECM / effort)

### A. Do next (high value, moderate effort)
1. **Owner alerts**: text/email when an estimate is approved, a contract is signed, a payment lands, a job is completed. (Jobber, ServiceTitan: standard.)
2. **Payment link / pay-now button** on invoices, estimates, contracts; deposit request at approval (50/50 default). (Jobber, ServiceTitan.)
3. **Appointment reminders + "on my way" texts** automated (job-reminders cron exists but is not scheduled; needs a plan check). (Jobber, ServiceTitan, Podium.)
4. **Dispatch / calendar view**: a drag-around day and week board across techs. Today there is a list/board, no calendar. (ServiceTitan dispatch board, Jobber calendar.)
5. **Review requests after a completed job** (Google review link by text). (Podium's core feature.)
6. **Access notes on the Field Board card** (column added in PR #43; display on the truck app is a small follow-up).

### B. Soon (good value, bigger effort)
7. **Pipeline / lead stages** with source tracking and follow-up reminders (leads table exists; needs stage board, next-step dates, won/lost reason). (Salesforce, Jobber requests.)
8. **Recurring jobs / visit schedule** generated from maintenance plans (annual tune-ups auto-scheduled). (Jobber recurring jobs, ServiceTitan memberships.)
9. **Good / better / best options on estimates** with customer picking one. Price book already has tiers. (Jobber, ServiceTitan.)
10. **Tech time tracking and timesheets**, tied to jobs (time on site is captured now), exportable for payroll; optional push to Square. (Jobber, ServiceTitan.)
11. **Inventory on the truck**: stock levels per truck, parts used on a job deducts stock. (Inventory exists in the office; no per-truck use.) (ServiceTitan.)
12. **Private photo storage** with signed links (security follow-up to the lockdown).
13. **Customer notes / activity timeline** on one page (calls, texts, estimates, jobs, payments in order). (Salesforce, Podium.)

### C. Later / only if needed
14. Two-way text inbox with templates, mass texts (Podium inbox). Conversations exists; templates and campaigns do not.
15. Marketing: email/text campaigns, seasonal tune-up promotions, referral tracking beyond the existing reward.
16. Reporting beyond the dashboard: job profitability, revenue by service type, tech productivity, lead source ROI.
17. GPS / tech location, route ordering. (ServiceTitan.) Low value for a small crew.
18. Financing offers (Wisetack / GreenSky style) on estimates.
19. Equipment lifecycle alerts (age / warranty expiring) to drive replacement sales.
20. Multi-location, call-center booking, custom objects: skip, enterprise features.

## Employee (tech) side wish list
- Today's jobs first, assigned to me highlighted (done), time on site (done).
- Job details: customer notes, access notes, equipment history for this property, last service.
- Checklists per job type (install report done; maintenance checklists exist as PM; add a repair/service call checklist).
- Capture: photos (done), signature, parts used, labor time, notes, then invoice or send for approval from the truck.
- Change my own password (techs have no account page yet).
- Offline tolerance for basements and rural jobs (queue actions until signal returns).

## Suggested order
1. Owner alerts, 2. payment link, 3. access notes on the truck card + equipment history on the job, 4. review requests, 5. dispatch calendar, 6. recurring visits from plans, 7. lead pipeline.

## Status of this session's builds
- PR #41: signing a maintenance contract creates the active plan.
- PR #42: install report with several units (model, serial, lineset footage). Needs migration 0050.
- PR #43: customers and properties (company, second phone, access notes, add first property with customer). Needs migration 0051.
