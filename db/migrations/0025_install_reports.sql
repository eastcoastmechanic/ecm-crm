-- Tech Hub: Install Report. Ported from the field HVAC calculators
-- (lineset charge, nitrogen pressure test, vacuum/decay) that lived in
-- ECM_Field_App.html, matching the pattern already used for the
-- diagnostics feature's superheat/subcooling math (lib/refrigerant.ts,
-- 7bcfb11). This is a genuinely new capability -- nothing in the CRM
-- currently captures an installation completion report.

create table install_reports (
  id uuid primary key default gen_random_uuid(),

  job_id uuid references jobs(id),
  customer_id uuid references customers(id),
  property_id uuid references properties(id),
  equipment_id uuid references equipment(id),
  tech_name text,

  system_type text,
  zone_config text,
  brand text,
  model text,
  serial text,
  refrigerant_type text,
  lineset_size text,

  lineset_total_ft numeric,
  factory_charge_oz numeric,
  charge_rate_oz_per_ft numeric,
  actual_charge_added_oz numeric,

  pressure_test_psig numeric,
  pressure_test_ambient_f numeric,
  pressure_test_start_at timestamptz,
  pressure_test_end_at timestamptz,
  pressure_test_start_psig numeric,
  pressure_test_end_psig numeric,

  vacuum_target_microns numeric,
  vacuum_achieved_microns numeric,
  decay_start_microns numeric,
  decay_end_microns numeric,
  decay_duration_min numeric,

  -- [{ "item": "Electrical connections verified", "result": "yes" | "no" | "na" }]
  startup_checks jsonb not null default '[]',
  notes text,

  tech_sign_name text,
  customer_sign_name text,
  signed_at timestamptz,

  created_at timestamptz not null default now()
);

create index install_reports_job_idx on install_reports(job_id);
create index install_reports_customer_idx on install_reports(customer_id);
create index install_reports_created_at_idx on install_reports(created_at desc);

alter table install_reports enable row level security;
create policy "internal full access" on install_reports for all to anon using (true) with check (true);
