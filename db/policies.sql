-- Phase 1 RLS policies: solo/internal use only, no auth yet.
-- Every table gets full access for the anon + authenticated roles so the
-- internal app (using the anon key) can read/write freely.
-- Revisit before Phase 4 (client portal) introduces real customer auth —
-- that's when these need to become scoped, per-user policies instead of
-- "allow everything".

alter table companies enable row level security;
alter table customers enable row level security;
alter table properties enable row level security;
alter table equipment enable row level security;
alter table service_contracts enable row level security;
alter table price_book_items enable row level security;
alter table documents enable row level security;
alter table diagnostics enable row level security;
alter table jobs enable row level security;
-- equipment_costs is wholesale cost data — internal/ECM-facing only.
-- No customer-facing policy should ever be added for this table.
alter table equipment_costs enable row level security;

create policy "internal full access" on companies for all using (true) with check (true);
create policy "internal full access" on customers for all using (true) with check (true);
create policy "internal full access" on properties for all using (true) with check (true);
create policy "internal full access" on equipment for all using (true) with check (true);
create policy "internal full access" on service_contracts for all using (true) with check (true);
create policy "internal full access" on price_book_items for all using (true) with check (true);
create policy "internal full access" on documents for all using (true) with check (true);
create policy "internal full access" on diagnostics for all using (true) with check (true);
create policy "internal full access" on jobs for all using (true) with check (true);
create policy "internal full access" on equipment_costs for all using (true) with check (true);
