-- Square is the shop's live payment processor (POS + Square Invoices).
-- Dashboard totals already hit Square on every load; this stores invoice and
-- payment status in the CRM so staff can see who paid without leaving the app,
-- and so matching CRM documents can flip to paid.
--
-- customer_id / document_id are SET NULL on delete so existing unconditional
-- customer and document deletes keep working.

alter table customers
  add column if not exists square_customer_id text;

create unique index if not exists customers_square_customer_id_idx
  on customers (square_customer_id)
  where square_customer_id is not null;

alter table documents
  add column if not exists square_invoice_id text;

create unique index if not exists documents_square_invoice_id_idx
  on documents (square_invoice_id)
  where square_invoice_id is not null;

create table if not exists square_invoices (
  id uuid primary key default gen_random_uuid(),
  square_invoice_id text not null unique,
  square_customer_id text,
  square_order_id text,
  invoice_number text,
  title text,
  status text not null,
  total_cents integer not null default 0,
  amount_paid_cents integer not null default 0,
  amount_due_cents integer not null default 0,
  currency text not null default 'USD',
  public_url text,
  square_customer_name text,
  square_customer_email text,
  square_customer_phone text,
  customer_id uuid references customers(id) on delete set null,
  document_id uuid references documents(id) on delete set null,
  square_created_at timestamptz,
  paid_at timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists square_invoices_customer_idx on square_invoices (customer_id);
create index if not exists square_invoices_status_idx on square_invoices (status);
create index if not exists square_invoices_created_idx on square_invoices (square_created_at desc);

create table if not exists square_payments (
  id uuid primary key default gen_random_uuid(),
  square_payment_id text not null unique,
  square_customer_id text,
  square_order_id text,
  square_invoice_id text,
  status text not null,
  amount_cents integer not null default 0,
  tip_cents integer not null default 0,
  total_cents integer not null default 0,
  currency text not null default 'USD',
  source_type text,
  card_brand text,
  card_last4 text,
  receipt_url text,
  note text,
  customer_id uuid references customers(id) on delete set null,
  square_created_at timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists square_payments_customer_idx on square_payments (customer_id);
create index if not exists square_payments_created_idx on square_payments (square_created_at desc);
create index if not exists square_payments_status_idx on square_payments (status);

alter table square_invoices enable row level security;
alter table square_payments enable row level security;

drop policy if exists "internal full access square invoices" on square_invoices;
create policy "internal full access square invoices" on square_invoices
  for all to anon
  using (true)
  with check (true);

drop policy if exists "internal full access square payments" on square_payments;
create policy "internal full access square payments" on square_payments
  for all to anon
  using (true)
  with check (true);
