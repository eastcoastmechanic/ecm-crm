# ECM CRM Phase 2: truck app complete for a tech (2026-10-23)

Phase 1 (owner alerts, job billing line, payment link, deposit tracking) is merged: PRs #44, #45, #46, #47.

## What the code shows (corrects the master plan again)
- **The service-call report already exists.** `/diagnostics` is the repair report: readings, AI diagnosis, parts used, finish and send, PDF. The master plan said repairs had nothing. Wrong.
- **Tracked hours already work.** `job-lifecycle.ts` stamps `arrived_at`, `completed_at` and `tracked_hours` when the tech taps I'm here / Finish.
- **The real gap is access and visibility.** `proxy.ts` lets a tech reach only `/field-board` and `/pm`. A tech cannot open `/diagnostics`, `/tech-hub/install-report` or `/account`, so the reports and password change are office-only in practice. The truck job card shows only name, address, phone and job notes. It does not show the property access notes, equipment on file or last visit.

## Rules for every PR in this phase
- Techs never see prices. Anything a tech can open is fetched with only non-money fields, and money components are hidden server-side, not just styled away.
- Each PR is one change: preview, Josh tests, "merge N". Columns ship as SQL for Josh to run.

## Plan
1. **Truck job card details** (no migration): property access notes, customer notes, equipment on file (make, model, serial, install date), last completed visit date. Read-only. Shown on the primary card and expandable on the others.
2. **Tech account page**: allow `/account` for techs (password change only) and add it to the tech tab bar. Check the page shows no other staff data.
3. **Tech service report**: "Service report" button on the truck card opens `/diagnostics/new?job_id=...` for techs, with every price and total hidden for the tech role (parts form shows names and quantities only; PDF and send stay office-only).
4. **Tech install report access**: same for the install checklist, which already supports several units.
5. **Parts used deduct inventory**: when a report is finished, parts that match an inventory item reduce `qty_on_hand`, with a low-stock flag. Needs a check of how parts are matched to price-book items first.
6. **Tech hours**: weekly totals per tech from `tracked_hours` for payroll, office-only.

## Order
1, 2, 3, 4, 5, 6. Items 1 and 2 are small and safe, so they go first and give Josh something to test on his phone.
