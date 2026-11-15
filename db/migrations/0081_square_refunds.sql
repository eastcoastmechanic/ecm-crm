-- 0081: Square refunds (full Square history import on /payments).
--
--   square_refunds : one row per Square refund, read from Square's Refunds API by the
--                    owner-only "Import full Square history" button. Linked to the CRM
--                    customer through the refunded payment (square_payments.customer_id).
--
-- Number note: 0081 was free when this was written. If another PR took 0081 first,
-- rename this file to the next free number; the SQL itself does not depend on it.
--
-- Run in Supabase BEFORE pressing Import on the preview (the preview uses the live
-- database). Until it is run, the import stops at once with "Run SQL 0081 first" and the
-- customer Timeline simply shows no refunds.
--
-- Additive and safe to re-run. No existing data is changed or deleted.
-- Internal only: RLS on with no policies; the server uses the service role (same as 0073).

create table if not exists square_refunds (
  id uuid primary key default gen_random_uuid(),
  square_refund_id text not null unique,
  square_payment_id text,
  square_order_id text,
  square_location_id text,
  square_customer_id text,
  status text not null,
  amount_cents integer not null default 0,
  processing_fee_cents integer not null default 0,
  currency text not null default 'USD',
  reason text,
  destination_type text,
  customer_id uuid references customers(id) on delete set null,
  square_created_at timestamptz,
  square_updated_at timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists square_refunds_customer_idx on square_refunds (customer_id);
create index if not exists square_refunds_payment_idx on square_refunds (square_payment_id);
create index if not exists square_refunds_created_idx on square_refunds (square_created_at desc);

alter table square_refunds enable row level security;
revoke all on square_refunds from anon, authenticated;

-- Check: one row, table_exists = true and rls_on = true.
select
  to_regclass('public.square_refunds') is not null as table_exists,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.square_refunds')), false) as rls_on;
