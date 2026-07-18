# Build Roadmap

## Phase 1 — Data Backbone (2-3 weeks solo)
- Postgres schema: companies, customers, properties, equipment, service_contracts, price_book_items
- Import existing ECM price book (already in Square) + equipment spec reference
- Basic internal auth (just you for now)
- Simple CRUD UI: view/add/edit customers, properties, equipment

## Phase 2 — AI Document Generation (3-4 weeks)
- "New Invoice/Estimate/Proposal" screen: text or voice input
- Claude API call: parses request → cross-references price book + customer/equipment history → returns structured JSON (line items, quantities, tier pricing)
- Review/edit screen before send
- PDF generation + send via email (Resend)
- Store as records tied to customer/property

## Phase 3 — Diagnostic Tool (2-3 weeks)
- Structured input form: readings (pressures, temps, amp draw, etc.) by equipment type
- Claude prompt loaded with Master Equipment Spec Reference as context
- Output: likely fault diagnosis + recommended fix + auto-suggested invoice line items
- Log diagnostic history per equipment record

## Phase 4 — Client Portal (3-4 weeks)
- Separate auth flow for customers
- View equipment (age, model, warranty status), service contracts, invoice/payment history
- Stripe payment on invoices
- Request service / book appointment (simple calendar slots to start)

## Phase 5 — Email Automation (2 weeks)
- Outbound: invoice reminders, contract renewal notices, follow-up after job completion
- Inbound: webhook + Claude classification (new lead vs reply vs question) → routes to appropriate record/notification

## Phase 6 — Scheduling / Dispatch (4+ weeks, hardest module)
- Calendar view, drag-drop job assignment
- Route awareness (even solo, useful for day planning)
- Only build this once everything else is in daily use — it's the most complex UI in the whole system and Jobber's actual moat

## Notes
- Each phase should be usable on its own before moving to the next — don't let this become another unfinished roadmap.
- Claude Code is the right tool for the actual build (vs. chat-based artifacts) since this needs a real persistent repo, migrations, and iterative dev over months.
