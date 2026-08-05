-- Adds an internal-only wholesale/cost figure per price book item, so
-- estimates/invoices/proposals can show a profit view to staff without ever
-- exposing it customer-facing (the PDF and /portal pages never read this
-- column). Nullable: items nobody has priced out yet just show as
-- "cost unknown" in the profit view rather than a wrong number.
alter table price_book_items add column if not exists unit_cost numeric(10,2);
