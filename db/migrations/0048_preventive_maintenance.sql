-- Preventive maintenance checklists.
--
-- Templates live in the database so the office can edit items later without a
-- deploy. A checklist copies the template's items at creation time, so an edit
-- does not rewrite a visit that is already in progress.
--
-- documents.type gains 'pm_report'. The row is the filed copy of a completed
-- checklist and points at the job (documents.job_id, migration 0035). It is
-- inserted as status 'draft' so the customer portal policy (status <> 'draft')
-- does not treat it as an estimate.
--
-- Photos of coils, drains, and data plates are the inside of a customer's
-- equipment. Both buckets are private. Reads go through signed URLs.

create table if not exists pm_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  audience text not null check (audience in ('residential', 'commercial')),
  items jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists pm_checklists (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  equipment_id uuid not null references equipment(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  template_id uuid references pm_templates(id) on delete set null,
  template_slug text,
  audience text not null check (audience in ('residential', 'commercial')),
  tech_name text,
  status text not null default 'draft' check (status in ('draft', 'complete')),
  recommendations text,
  completed_at timestamptz,
  document_id uuid references documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pm_checklists_job_idx on pm_checklists (job_id);
create index if not exists pm_checklists_equipment_idx on pm_checklists (equipment_id);
create index if not exists pm_checklists_created_idx on pm_checklists (created_at desc);

create table if not exists pm_checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references pm_checklists(id) on delete cascade,
  item_key text not null,
  section text not null,
  label text not null,
  help text,
  sort_order integer not null,
  result text check (result in ('pass', 'fail', 'na')),
  readings jsonb not null default '{}'::jsonb,
  reading_fields jsonb not null default '[]'::jsonb,
  notes text,
  photos jsonb not null default '[]'::jsonb,
  unique (checklist_id, item_key)
);

create index if not exists pm_checklist_items_checklist_idx on pm_checklist_items (checklist_id, sort_order);

alter table pm_templates enable row level security;
alter table pm_checklists enable row level security;
alter table pm_checklist_items enable row level security;

-- Same internal-only model as install_reports and purchase_orders: the anon
-- role the server uses, and no authenticated (customer portal) policy. The
-- service role bypasses RLS. Default deny covers everyone else.
drop policy if exists "internal full access pm templates" on pm_templates;
create policy "internal full access pm templates" on pm_templates
  for all to anon using (true) with check (true);

drop policy if exists "internal full access pm checklists" on pm_checklists;
create policy "internal full access pm checklists" on pm_checklists
  for all to anon using (true) with check (true);

drop policy if exists "internal full access pm checklist items" on pm_checklist_items;
create policy "internal full access pm checklist items" on pm_checklist_items
  for all to anon using (true) with check (true);

insert into storage.buckets (id, name, public)
values
  ('pm-photos', 'pm-photos', false),
  ('nameplate-photos', 'nameplate-photos', false)
on conflict (id) do nothing;

drop policy if exists "internal full access pm photos" on storage.objects;
create policy "internal full access pm photos" on storage.objects
  for all to anon
  using (bucket_id = 'pm-photos')
  with check (bucket_id = 'pm-photos');

drop policy if exists "internal full access nameplate photos" on storage.objects;
create policy "internal full access nameplate photos" on storage.objects
  for all to anon
  using (bucket_id = 'nameplate-photos')
  with check (bucket_id = 'nameplate-photos');

alter table documents drop constraint if exists documents_type_check;
alter table documents add constraint documents_type_check
  check (type in (
    'estimate',
    'invoice',
    'proposal',
    'assessment',
    'warranty',
    'mass_save_rebate',
    'contract',
    'pm_report'
  ));

-- Seed once. A later edit in the app must survive a re-run of this file.
insert into pm_templates (slug, name, audience, items)
values
  (
    'residential',
    'Residential preventive maintenance',
    'residential',
    $pm_residential$[{"key":"filters","section":"Airflow","label":"Filters","readings":[{"key":"size","label":"Filter size","input":"text"},{"key":"merv","label":"MERV","input":"text"}],"help":"Record size and condition. Fail if loaded, collapsed, or the wrong size."},{"key":"evaporator_coil","section":"Airflow","label":"Evaporator coil","readings":[],"help":"Clean and unobstructed. Note oil stains or ice."},{"key":"condenser_coil","section":"Airflow","label":"Condenser coil","readings":[],"help":"Fins straight enough to pass air. Note cottonwood, grass, or damage."},{"key":"condensate_drain","section":"Condensate","label":"Condensate drain","readings":[],"help":"Trap present, line clear, discharge where it belongs."},{"key":"condensate_pan","section":"Condensate","label":"Condensate pan","readings":[],"help":"No standing sludge, overflow, or rust-through."},{"key":"condensate_pump","section":"Condensate","label":"Condensate pump","readings":[],"help":"Pumps out and the check valve holds. Mark NA if the unit drains by gravity."},{"key":"float_switch","section":"Condensate","label":"Float switch","readings":[],"help":"Opens the circuit when the pan is lifted. Mark NA if there is no float."},{"key":"electrical_connections","section":"Electrical","label":"Electrical connections","readings":[],"help":"Lugs tight, no burned insulation, whip and disconnect in good shape."},{"key":"capacitors","section":"Electrical","label":"Capacitors (rated vs measured)","readings":[{"key":"herm_rated_uf","label":"Herm rated","unit":"µF","input":"number"},{"key":"herm_measured_uf","label":"Herm measured","unit":"µF","input":"number"},{"key":"fan_rated_uf","label":"Fan rated","unit":"µF","input":"number"},{"key":"fan_measured_uf","label":"Fan measured","unit":"µF","input":"number"}],"help":"Read the value printed on the capacitor, then measure it. Note any extra capacitors in the notes."},{"key":"contactors","section":"Electrical","label":"Contactors","readings":[],"help":"Points not pitted, coil pulls in, no chatter."},{"key":"suction_pressure","section":"Refrigerant","label":"Suction pressure","readings":[{"key":"suction_psig","label":"Suction","unit":"psig","input":"number"}]},{"key":"liquid_pressure","section":"Refrigerant","label":"Liquid pressure","readings":[{"key":"liquid_psig","label":"Liquid","unit":"psig","input":"number"}]},{"key":"superheat","section":"Refrigerant","label":"Superheat","readings":[{"key":"superheat_f","label":"Superheat","unit":"°F","input":"number"}]},{"key":"subcool","section":"Refrigerant","label":"Subcooling","readings":[{"key":"subcool_f","label":"Subcool","unit":"°F","input":"number"}]},{"key":"supply_return","section":"Temperatures","label":"Supply / return temperatures and split","readings":[{"key":"supply_f","label":"Supply","unit":"°F","input":"number"},{"key":"return_f","label":"Return","unit":"°F","input":"number"},{"key":"split_f","label":"Temperature split","unit":"°F","input":"number"}],"help":"Split is return minus supply for cooling. The form fills a split once both temps are entered; change it if you measured it yourself."},{"key":"compressor_amps","section":"Motors","label":"Compressor amps vs RLA","readings":[{"key":"measured_a","label":"Measured","unit":"A","input":"number"},{"key":"rla","label":"RLA","unit":"A","input":"number"}]},{"key":"condenser_fan_amps","section":"Motors","label":"Condenser fan motor amps vs FLA","readings":[{"key":"measured_a","label":"Measured","unit":"A","input":"number"},{"key":"fla","label":"FLA","unit":"A","input":"number"}]},{"key":"blower_amps","section":"Motors","label":"Blower motor amps vs FLA","readings":[{"key":"measured_a","label":"Measured","unit":"A","input":"number"},{"key":"fla","label":"FLA","unit":"A","input":"number"}]},{"key":"burner","section":"Gas heat","label":"Burner","readings":[],"help":"Carryover, flame color, and no rollout. Mark NA on electric or heat-pump-only equipment."},{"key":"flame_sensor","section":"Gas heat","label":"Flame sensor","readings":[{"key":"microamps","label":"Flame signal","unit":"µA","input":"number"}],"help":"Mark NA if the unit has no flame sensor."},{"key":"igniter","section":"Gas heat","label":"Igniter","readings":[],"help":"Hot-surface or spark. Mark NA if there is no igniter."},{"key":"heat_exchanger","section":"Gas heat","label":"Heat exchanger","readings":[],"help":"No visible cracks, rust-through, or flame disturbance. Mark NA on electric heat."},{"key":"combustion_analysis","section":"Gas heat","label":"Combustion analysis","readings":[{"key":"o2_pct","label":"O2","unit":"%","input":"number"},{"key":"co2_pct","label":"CO2","unit":"%","input":"number"},{"key":"stack_f","label":"Stack temperature","unit":"°F","input":"number"}],"help":"Mark NA when a combustion analyzer was not used."},{"key":"co_ambient","section":"Gas heat","label":"CO ambient","readings":[{"key":"ppm","label":"Ambient CO","unit":"ppm","input":"number"}],"help":"Measured in the occupied space, not in the flue."},{"key":"co_flue","section":"Gas heat","label":"CO flue","readings":[{"key":"ppm","label":"Flue CO","unit":"ppm","input":"number"}]},{"key":"venting","section":"Gas heat","label":"Venting","readings":[],"help":"Pitch, clearance, terminations, and no spillage. Mark NA on electric heat."},{"key":"gas_pressure","section":"Gas heat","label":"Gas pressure","readings":[{"key":"inlet_wc","label":"Inlet","unit":"in. w.c.","input":"number"},{"key":"manifold_wc","label":"Manifold","unit":"in. w.c.","input":"number"}],"help":"Mark NA on electric heat."},{"key":"belts","section":"Drive","label":"Belts","readings":[],"help":"Tension and wear. Mark NA on direct-drive equipment."},{"key":"pulleys","section":"Drive","label":"Pulleys","readings":[],"help":"Alignment and set screws. Mark NA on direct-drive equipment."},{"key":"bearings","section":"Drive","label":"Bearings","readings":[],"help":"No growl, play, or heat. Mark NA if the motor is sealed and not serviceable."},{"key":"ductwork","section":"Distribution","label":"Ductwork","readings":[],"help":"Connections seated, insulation intact, no obvious leaks at the air handler."},{"key":"static_pressure","section":"Distribution","label":"Static pressure","readings":[{"key":"supply_wc","label":"Supply","unit":"in. w.c.","input":"number"},{"key":"return_wc","label":"Return","unit":"in. w.c.","input":"number"},{"key":"total_wc","label":"Total external","unit":"in. w.c.","input":"number"}]},{"key":"thermostat_calibration","section":"Controls","label":"Thermostat calibration","readings":[{"key":"offset_f","label":"Offset","unit":"°F","input":"number"}],"help":"Compare the thermostat to a measured room temperature. Offset is thermostat minus measured."},{"key":"thermostat_operation","section":"Controls","label":"Thermostat operation","readings":[],"help":"Calls for heat and cool, fan runs in the selected mode, schedule is not fighting the call."},{"key":"high_pressure_switch","section":"Safeties","label":"High pressure switch","readings":[],"help":"Wired and not jumped."},{"key":"low_pressure_switch","section":"Safeties","label":"Low pressure switch","readings":[],"help":"Wired and not jumped. Mark NA if the unit has no low-pressure switch."},{"key":"limit_switches","section":"Safeties","label":"Limit switches","readings":[],"help":"High limit present and not jumped. Mark NA if this unit has no limit."},{"key":"rollout_switch","section":"Safeties","label":"Rollout switch","readings":[],"help":"Not tripped and not jumped. Mark NA on equipment with no rollout."}]$pm_residential$::jsonb
  ),
  (
    'commercial',
    'Commercial rooftop preventive maintenance',
    'commercial',
    $pm_commercial$[{"key":"filters","section":"Airflow","label":"Filters","readings":[{"key":"size","label":"Filter size","input":"text"},{"key":"merv","label":"MERV","input":"text"}],"help":"Record size and condition. Fail if loaded, collapsed, or the wrong size."},{"key":"evaporator_coil","section":"Airflow","label":"Evaporator coil","readings":[],"help":"Clean and unobstructed. Note oil stains or ice."},{"key":"condenser_coil","section":"Airflow","label":"Condenser coil","readings":[],"help":"Fins straight enough to pass air. Note cottonwood, grass, or damage."},{"key":"condensate_drain","section":"Condensate","label":"Condensate drain","readings":[],"help":"Trap present, line clear, discharge where it belongs."},{"key":"condensate_pan","section":"Condensate","label":"Condensate pan","readings":[],"help":"No standing sludge, overflow, or rust-through."},{"key":"condensate_pump","section":"Condensate","label":"Condensate pump","readings":[],"help":"Pumps out and the check valve holds. Mark NA if the unit drains by gravity."},{"key":"float_switch","section":"Condensate","label":"Float switch","readings":[],"help":"Opens the circuit when the pan is lifted. Mark NA if there is no float."},{"key":"electrical_connections","section":"Electrical","label":"Electrical connections","readings":[],"help":"Lugs tight, no burned insulation, whip and disconnect in good shape."},{"key":"capacitors","section":"Electrical","label":"Capacitors (rated vs measured)","readings":[{"key":"herm_rated_uf","label":"Herm rated","unit":"µF","input":"number"},{"key":"herm_measured_uf","label":"Herm measured","unit":"µF","input":"number"},{"key":"fan_rated_uf","label":"Fan rated","unit":"µF","input":"number"},{"key":"fan_measured_uf","label":"Fan measured","unit":"µF","input":"number"}],"help":"Read the value printed on the capacitor, then measure it. Note any extra capacitors in the notes."},{"key":"contactors","section":"Electrical","label":"Contactors","readings":[],"help":"Points not pitted, coil pulls in, no chatter."},{"key":"suction_pressure","section":"Refrigerant","label":"Suction pressure","readings":[{"key":"suction_psig","label":"Suction","unit":"psig","input":"number"}]},{"key":"liquid_pressure","section":"Refrigerant","label":"Liquid pressure","readings":[{"key":"liquid_psig","label":"Liquid","unit":"psig","input":"number"}]},{"key":"superheat","section":"Refrigerant","label":"Superheat","readings":[{"key":"superheat_f","label":"Superheat","unit":"°F","input":"number"}]},{"key":"subcool","section":"Refrigerant","label":"Subcooling","readings":[{"key":"subcool_f","label":"Subcool","unit":"°F","input":"number"}]},{"key":"supply_return","section":"Temperatures","label":"Supply / return temperatures and split","readings":[{"key":"supply_f","label":"Supply","unit":"°F","input":"number"},{"key":"return_f","label":"Return","unit":"°F","input":"number"},{"key":"split_f","label":"Temperature split","unit":"°F","input":"number"}],"help":"Split is return minus supply for cooling. The form fills a split once both temps are entered; change it if you measured it yourself."},{"key":"compressor_amps","section":"Motors","label":"Compressor amps vs RLA","readings":[{"key":"measured_a","label":"Measured","unit":"A","input":"number"},{"key":"rla","label":"RLA","unit":"A","input":"number"}]},{"key":"condenser_fan_amps","section":"Motors","label":"Condenser fan motor amps vs FLA","readings":[{"key":"measured_a","label":"Measured","unit":"A","input":"number"},{"key":"fla","label":"FLA","unit":"A","input":"number"}]},{"key":"blower_amps","section":"Motors","label":"Blower motor amps vs FLA","readings":[{"key":"measured_a","label":"Measured","unit":"A","input":"number"},{"key":"fla","label":"FLA","unit":"A","input":"number"}]},{"key":"burner","section":"Gas heat","label":"Burner","readings":[],"help":"Carryover, flame color, and no rollout. Mark NA on electric or heat-pump-only equipment."},{"key":"flame_sensor","section":"Gas heat","label":"Flame sensor","readings":[{"key":"microamps","label":"Flame signal","unit":"µA","input":"number"}],"help":"Mark NA if the unit has no flame sensor."},{"key":"igniter","section":"Gas heat","label":"Igniter","readings":[],"help":"Hot-surface or spark. Mark NA if there is no igniter."},{"key":"heat_exchanger","section":"Gas heat","label":"Heat exchanger","readings":[],"help":"No visible cracks, rust-through, or flame disturbance. Mark NA on electric heat."},{"key":"combustion_analysis","section":"Gas heat","label":"Combustion analysis","readings":[{"key":"o2_pct","label":"O2","unit":"%","input":"number"},{"key":"co2_pct","label":"CO2","unit":"%","input":"number"},{"key":"stack_f","label":"Stack temperature","unit":"°F","input":"number"}],"help":"Mark NA when a combustion analyzer was not used."},{"key":"co_ambient","section":"Gas heat","label":"CO ambient","readings":[{"key":"ppm","label":"Ambient CO","unit":"ppm","input":"number"}],"help":"Measured in the occupied space, not in the flue."},{"key":"co_flue","section":"Gas heat","label":"CO flue","readings":[{"key":"ppm","label":"Flue CO","unit":"ppm","input":"number"}]},{"key":"venting","section":"Gas heat","label":"Venting","readings":[],"help":"Pitch, clearance, terminations, and no spillage. Mark NA on electric heat."},{"key":"gas_pressure","section":"Gas heat","label":"Gas pressure","readings":[{"key":"inlet_wc","label":"Inlet","unit":"in. w.c.","input":"number"},{"key":"manifold_wc","label":"Manifold","unit":"in. w.c.","input":"number"}],"help":"Mark NA on electric heat."},{"key":"belts","section":"Drive","label":"Belts","readings":[],"help":"Tension and wear. Mark NA on direct-drive equipment."},{"key":"pulleys","section":"Drive","label":"Pulleys","readings":[],"help":"Alignment and set screws. Mark NA on direct-drive equipment."},{"key":"bearings","section":"Drive","label":"Bearings","readings":[],"help":"No growl, play, or heat. Mark NA if the motor is sealed and not serviceable."},{"key":"ductwork","section":"Distribution","label":"Ductwork","readings":[],"help":"Connections seated, insulation intact, no obvious leaks at the air handler."},{"key":"static_pressure","section":"Distribution","label":"Static pressure","readings":[{"key":"supply_wc","label":"Supply","unit":"in. w.c.","input":"number"},{"key":"return_wc","label":"Return","unit":"in. w.c.","input":"number"},{"key":"total_wc","label":"Total external","unit":"in. w.c.","input":"number"}]},{"key":"thermostat_calibration","section":"Controls","label":"Thermostat calibration","readings":[{"key":"offset_f","label":"Offset","unit":"°F","input":"number"}],"help":"Compare the thermostat to a measured room temperature. Offset is thermostat minus measured."},{"key":"thermostat_operation","section":"Controls","label":"Thermostat operation","readings":[],"help":"Calls for heat and cool, fan runs in the selected mode, schedule is not fighting the call."},{"key":"high_pressure_switch","section":"Safeties","label":"High pressure switch","readings":[],"help":"Wired and not jumped."},{"key":"low_pressure_switch","section":"Safeties","label":"Low pressure switch","readings":[],"help":"Wired and not jumped. Mark NA if the unit has no low-pressure switch."},{"key":"limit_switches","section":"Safeties","label":"Limit switches","readings":[],"help":"High limit present and not jumped. Mark NA if this unit has no limit."},{"key":"rollout_switch","section":"Safeties","label":"Rollout switch","readings":[],"help":"Not tripped and not jumped. Mark NA on equipment with no rollout."},{"key":"economizer_operation","section":"Rooftop unit","label":"Economizer operation","readings":[],"help":"Brings in outdoor air when it should and closes when it should not."},{"key":"economizer_dampers","section":"Rooftop unit","label":"Economizer dampers","readings":[],"help":"Travel fully, seals meet, no stuck blades."},{"key":"economizer_actuator","section":"Rooftop unit","label":"Economizer actuator","readings":[],"help":"Drives the dampers through the stroke and holds."},{"key":"roof_curb","section":"Rooftop unit","label":"Curb","readings":[],"help":"Gasket, attachment, and no daylight or water into the curb."},{"key":"access_panels","section":"Rooftop unit","label":"Panels","readings":[],"help":"Panels on, screws present, rain shedding the right way."},{"key":"disconnect","section":"Rooftop unit","label":"Disconnect","readings":[],"help":"Within sight, legs intact, cover on."},{"key":"multiple_stages","section":"Rooftop unit","label":"Multiple stages","readings":[{"key":"stages","label":"Stages observed","input":"text"},{"key":"stage_1_a","label":"Stage 1","unit":"A","input":"number"},{"key":"stage_2_a","label":"Stage 2","unit":"A","input":"number"}],"help":"Run each stage. Record how many stages came in and the amps on the stages you ran."}]$pm_commercial$::jsonb
  )
on conflict (slug) do nothing;
