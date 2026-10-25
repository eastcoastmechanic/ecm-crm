# ECM CRM Phase 3 plan: scheduling and recurring revenue (2026-10-23)

Phases 1 and 2 are merged (#44 to #52). #53 (inventory double-deduction fix) is open. This plan comes from the master plan plus what the code shows today.

## Goal
Jobs get on a calendar with the right tech, every maintenance plan produces its visits without anyone remembering, and everyone (customer, tech, Josh) gets the reminder they need. Recurring plan revenue is the steady part of the business, so visits and reminders matter most.

## What exists today (read from the repo)
- `jobs` has `scheduled_at`, `assigned_staff_id`, `status`, `job_type` (install by default), `on_way_at`, `arrived_at`, `completed_at`, `tracked_hours`, `document_id`, `reminder_sent_at`, `appointment_reminder_sent_at`.
- Route optimization exists (`/api/dispatch/optimize`, used on the Jobs page). No calendar view.
- Crons in `vercel.json`: email-reminders, task-reminders, appointment-reminders (daily 14:00 UTC, texts the customer the day before, only with `sms_consent`), square-sync. `job-reminders` (email to owner 45 to 75 minutes before a job) is NOT scheduled, so it never runs.
- Plans live on contract documents (`plan_name`, `end_date`, `renewal_price_cents`, auto-renew consent, `renewal_reminder_sent_at`). Renewal billing runs from `email-reminders`. A plan is created automatically when a contract is signed (#41). Nothing creates the visits a plan promises.
- `pm_templates` / `pm_checklists` (migration 0048) hold the maintenance checklists techs fill on site.
- Not yet checked: exact plan columns and how many visits each plan includes. Step 0 below confirms this before any code.

## Order of work (one PR each; you test the preview, then "merge N")

**0. Confirm the plan data (no code).** List real plan names, visit counts and start dates in the database. Nothing below invents visit counts; if a plan does not say how many visits it includes, we add that field and you fill it in.

**1. Schedule `job-reminders` and send it to the right people.** Cheapest win. Today it is never scheduled. Plan: add it to `vercel.json`; first check the Vercel plan allows a sub-daily cron. If it does not, replace it with one morning digest (7:00 ET) to Josh and to each tech listing their jobs for the day. Also send the assigned tech their own reminder. No migration.

**2. Dispatch calendar.** New `/dispatch` page (office/owner only): week and day view, one column per tech plus Unassigned, jobs shown as blocks with customer, address and status colour. Click a job to reassign tech or change time using the existing job actions, so the Planner/Graph sync and customer schedule notifications keep firing. Drag-and-drop comes second; version one is click-to-edit so it ships fast and works on a phone. Keeps the existing route optimizer link. No migration.

**3. Recurring maintenance visits from plans.** The big one.
- Add a `maintenance_visits` table (plan/contract id, due month, status, job id once scheduled) so a plan's visits are tracked, not guessed. SQL for you to run, as with 0052.
- A daily cron looks at active plans and creates the next due visit as an unscheduled job (type maintenance, linked to the plan), and puts it on a "Needs scheduling" list on the dispatch calendar.
- Customer reminder to book (text only with consent, otherwise email), and a follow-up if they do not book.
- When the tech opens a visit job, the PM checklist starts from the right template.
- Completing the visit marks it done in the plan. Plans with a visit overdue show on the dashboard.

**4. Customer self-confirm (optional, only if you want it).** A link in the reminder to confirm or ask to reschedule; the request lands as an owner alert, no automatic changes.

## Decisions I need from you
- Visits per plan: how many a year, and which months (for example spring AC tune and fall heating tune)?
- Reminders: text and email both, or text first and email only if no consent?
- Tech reminders: morning digest for the whole day, or one text before each job?
- Does Vercel allow the more frequent cron on your plan (I will check in step 1)?

## Risks and rules I will hold to
- No migration runs without your say-so; each ships as SQL for you to run and verify.
- Texts only go to customers with `sms_consent`.
- No invented customers, prices or visit counts.
- The calendar edits jobs only through the existing job actions so notifications and Planner sync are not bypassed.
- Each PR ends with the review bot clean and CI green before I ask you to test.

## Done when
Every job shows on a calendar with a tech, a signed plan produces its visits on its own, each tech gets a daily reminder, and no plan visit can go overdue without showing on the dashboard.

## After Phase 3 (unchanged from master plan)
Phase 4: lead pipeline board, good/better/best estimates, text review requests, seasonal campaigns. Phase 5: private photo buckets, OAuth rate limit, tests on money paths, reports.
