-- Local-dev base schema (the "Phase 1" schema.sql + policies.sql state that
-- existed BEFORE db/migrations/0001).
--
-- The numbered files in db/migrations/ are the source of truth for how the
-- schema evolved, but they assume the original Phase 1 core tables already
-- exist (migration 0001's own header says: "Run this once against a database
-- that already has the Phase 1 schema.sql and policies.sql applied"). That
-- original Phase 1 schema was applied directly and never captured as a
-- numbered migration, so this file reconstructs it: the nine core tables with
-- ONLY their pre-migration columns, plus the "internal full access" RLS
-- policies migration 0003 later re-scopes. Every later column and table is
-- added by replaying db/migrations/*.sql on top of this (all of which use
-- `add column if not exists` / `create table if not exists`).
--
-- db/schema.sql is a newer consolidated snapshot and intentionally NOT run
-- here — it mixes in migration-added columns and omits tables added by later
-- migrations, so it cannot be replayed cleanly.

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  name text not null,
  email text,
  phone text,
  billing_address text,
  notes text,
  created_at timestamptz default now()
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  address text not null,
  property_type text,
  created_at timestamptz default now()
);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id),
  type text not null,
  brand text,
  model text,
  serial_number text,
  install_date date,
  warranty_expiration date,
  refrigerant_type text,
  notes text,
  created_at timestamptz default now()
);

create table service_contracts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  property_id uuid references properties(id),
  plan_name text,
  start_date date,
  end_date date,
  status text default 'active',
  terms text,
  created_at timestamptz default now()
);

create table price_book_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  category text,
  tier text,
  name text not null,
  description text,
  unit_price numeric(10,2),
  labor_hours numeric(5,2),
  created_at timestamptz default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('estimate', 'invoice', 'proposal')),
  customer_id uuid references customers(id),
  property_id uuid references properties(id),
  status text default 'draft',
  line_items jsonb not null,
  subtotal numeric(10,2),
  tax numeric(10,2),
  total numeric(10,2),
  ai_generated boolean default true,
  raw_request text,
  created_at timestamptz default now(),
  sent_at timestamptz,
  paid_at timestamptz
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  property_id uuid references properties(id),
  scheduled_at timestamptz,
  status text default 'scheduled',
  document_id uuid references documents(id),
  created_at timestamptz default now()
);

create table diagnostics (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid references equipment(id),
  readings jsonb,
  ai_diagnosis text,
  suggested_fix text,
  suggested_line_items jsonb,
  created_at timestamptz default now()
);

-- Phase 1 RLS: internal app uses the anon key and needs full access. Migration
-- 0003 drops these (without `if exists`) and re-creates them scoped `to anon`,
-- so they must exist before the migrations run.
alter table companies enable row level security;
alter table customers enable row level security;
alter table properties enable row level security;
alter table equipment enable row level security;
alter table service_contracts enable row level security;
alter table price_book_items enable row level security;
alter table documents enable row level security;
alter table diagnostics enable row level security;
alter table jobs enable row level security;

create policy "internal full access" on companies for all using (true) with check (true);
create policy "internal full access" on customers for all using (true) with check (true);
create policy "internal full access" on properties for all using (true) with check (true);
create policy "internal full access" on equipment for all using (true) with check (true);
create policy "internal full access" on service_contracts for all using (true) with check (true);
create policy "internal full access" on price_book_items for all using (true) with check (true);
create policy "internal full access" on documents for all using (true) with check (true);
create policy "internal full access" on diagnostics for all using (true) with check (true);
create policy "internal full access" on jobs for all using (true) with check (true);
