-- Closes the two real gaps found while mapping the ops-planning pipeline
-- (leads/estimates/jobs/QC/mass-save/invoicing already had a home in
-- documents/jobs/diagnostics/leads — see ECM Operations Blueprint, 2026-08-17):
--
--   1. Parts/procurement has no representation anywhere — no table, no code.
--   2. A service call is indistinguishable from an install in `jobs` — there's
--      no column to tell them apart for reporting or for routing a Planner
--      card differently.
--
-- Also adds the join needed to move a job's Planner card between buckets
-- (lib/planner-connector.ts's movePlannerTaskToBucket) after a status change —
-- that function is already written and already tested, it just has nothing
-- telling it which task belongs to which job yet.

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),

  job_id uuid references jobs(id) on delete set null,
  vendor text not null,
  po_number text,

  -- selected: equipment/materials picked, not yet ordered.
  status text not null default 'selected'
    check (status in ('selected', 'issued', 'ordered', 'received', 'verified', 'delivered')),

  line_items jsonb not null default '[]',   -- [{ description, qty, unit_cost }]
  total_cost numeric(10,2),

  ordered_at timestamptz,
  received_at timestamptz,
  delivered_at timestamptz,

  notes text,
  created_at timestamptz not null default now()
);

create index if not exists purchase_orders_job_idx on purchase_orders (job_id);
-- Procurement follow-up is asked "what's still outstanding", not "show me everything".
create index if not exists purchase_orders_status_idx on purchase_orders (status) where status not in ('delivered');

-- Internal only — same anon-role precedent as every other internal table
-- (see refrigerant_log, 0032). No portal/customer access to procurement.
alter table purchase_orders enable row level security;

drop policy if exists "internal full access purchase orders" on purchase_orders;
create policy "internal full access purchase orders" on purchase_orders
  for all to anon
  using (true)
  with check (true);

-- Distinguishes an install from a service/repair visit so both can share the
-- `jobs` table and its status pipeline instead of forking into a second
-- table with a duplicate lifecycle.
alter table jobs add column if not exists job_type text not null default 'install'
  check (job_type in ('install', 'service', 'repair', 'maintenance', 'warranty'));

-- Links a job to its card in the "Jobs" Planner plan (see
-- scripts/planner-setup.mjs, lib/planner-connector.ts) so a status change can
-- call movePlannerTaskToBucket for the right task instead of creating a new
-- one or guessing.
alter table jobs add column if not exists planner_task_id text;
