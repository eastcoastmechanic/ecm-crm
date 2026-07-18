-- ECM Platform core schema (Phase 1)
-- Multi-tenant ready via company_id, even though v1 is single-tenant (ECM only)

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
  property_type text, -- residential / commercial
  created_at timestamptz default now()
);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id),
  type text not null,          -- e.g. mini-split, boiler, tankless water heater
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
  tier text,          -- good / better / best
  name text not null,
  description text,
  unit_price numeric(10,2),
  labor_hours numeric(5,2),
  created_at timestamptz default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('estimate','invoice','proposal')),
  customer_id uuid references customers(id),
  property_id uuid references properties(id),
  status text default 'draft', -- draft / sent / approved / paid
  line_items jsonb not null,   -- [{price_book_item_id, description, qty, unit_price, total}]
  subtotal numeric(10,2),
  tax numeric(10,2),
  total numeric(10,2),
  ai_generated boolean default true,
  raw_request text,             -- the original text/voice input from the tech
  created_at timestamptz default now(),
  sent_at timestamptz,
  paid_at timestamptz
);

create table diagnostics (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid references equipment(id),
  readings jsonb,               -- {superheat, subcooling, static_pressure, amp_draw, ...}
  ai_diagnosis text,
  suggested_fix text,
  suggested_line_items jsonb,
  created_at timestamptz default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  property_id uuid references properties(id),
  scheduled_at timestamptz,
  status text default 'scheduled', -- scheduled / in_progress / complete / cancelled
  document_id uuid references documents(id),
  created_at timestamptz default now()
);
