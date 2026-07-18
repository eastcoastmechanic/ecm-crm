-- Incremental migration: add equipment_costs (wholesale cost by brand/model).
-- Run this once against a database that already has the Phase 1 schema.sql
-- and policies.sql applied — it only adds what's new.

create table if not exists equipment_costs (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model_number text not null,
  cost numeric(10,2) not null,
  created_at timestamptz default now(),
  unique (brand, model_number)
);

alter table equipment_costs enable row level security;

drop policy if exists "internal full access" on equipment_costs;
create policy "internal full access" on equipment_costs for all using (true) with check (true);
