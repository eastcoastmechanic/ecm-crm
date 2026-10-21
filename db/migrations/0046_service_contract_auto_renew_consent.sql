-- Auto-charging a plan renewal needs the customer's written OK on the contract.
-- The renewal cron (app/api/cron/email-reminders) now charges ONLY contracts where
-- both columns are set. Null = never auto-charge (the renewal notice email still goes out).
--   auto_renew_authorized_at : when the customer agreed (signed contract) to automatic annual renewal
--   renewal_price_cents      : the price they agreed to for each renewal
alter table service_contracts add column if not exists auto_renew_authorized_at timestamptz;
alter table service_contracts add column if not exists renewal_price_cents integer check (renewal_price_cents is null or renewal_price_cents > 0);
