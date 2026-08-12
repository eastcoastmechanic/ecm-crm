-- Refrigerant handling record.
--
-- EPA 608 requires a technician to keep records of refrigerant added to and
-- recovered from appliances, and for systems with a full charge of 50 lb or
-- more, records of leak inspections and repairs. This is the table that makes
-- that record exist as data rather than as handwriting on a work order.
--
-- Deliberately not derived from diagnostics or install_reports: refrigerant
-- moves on jobs that produce neither (a top-up on a maintenance visit), and a
-- compliance record that only exists when some other form was filled in is not
-- a compliance record.
--
-- Amounts are stored in ounces because that is what techs read off a scale and
-- what install_reports already uses (factory_charge_oz, actual_charge_added_oz).
-- Pounds are a display concern.

create table if not exists refrigerant_log (
  id uuid primary key default gen_random_uuid(),

  job_id uuid references jobs(id) on delete set null,
  equipment_id uuid references equipment(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,

  -- added: into the system. recovered: out of it, into a recovery cylinder.
  action text not null check (action in ('added', 'recovered')),
  refrigerant_type text not null,          -- R-410A, R-32, R-454B, R-22
  amount_oz numeric(10,2) not null check (amount_oz >= 0),

  -- Which bottle it came from or went into. EPA cares about the chain, and
  -- this is the only thing tying a charge to a cylinder months later.
  cylinder_id text,

  -- Leak inspection / repair, per 608 for >=50 lb systems.
  leak_inspection boolean not null default false,
  leak_found boolean not null default false,
  leak_location text,
  leak_repaired boolean not null default false,

  tech_name text,
  notes text,
  performed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists refrigerant_log_job_idx on refrigerant_log (job_id);
create index if not exists refrigerant_log_equipment_idx on refrigerant_log (equipment_id);
-- Audits are asked by date range, so this is the index that matters most.
create index if not exists refrigerant_log_performed_idx on refrigerant_log (performed_at desc);

-- Internal only, following the equipment_costs precedent: `anon` is the
-- internal app's role, and the customer portal runs as `authenticated`
-- (0003_portal_auth.sql). The protection here is that no authenticated-role
-- policy is ever added for this table — this is ECM's compliance record, not
-- something a customer should be able to read.
alter table refrigerant_log enable row level security;

drop policy if exists "internal full access refrigerant log" on refrigerant_log;
create policy "internal full access refrigerant log" on refrigerant_log
  for all to anon
  using (true)
  with check (true);
