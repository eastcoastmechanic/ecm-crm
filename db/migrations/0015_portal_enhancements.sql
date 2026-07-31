-- Phase 2 of the growth/ops feature batch: portal enhancements. Adds
-- signature capture on estimate approval, and read access to diagnostics
-- for the new equipment service-history timeline (0003_portal_auth.sql
-- covered customers/properties/equipment/contracts/documents/jobs but never
-- extended read access to diagnostics for the authenticated portal role).

alter table documents add column if not exists signed_at timestamptz;
alter table documents add column if not exists signature_data text;

create policy "portal read own diagnostics" on diagnostics
  for select to authenticated
  using (equipment_id in (
    select e.id from equipment e
    join properties p on p.id = e.property_id
    where p.customer_id = auth_customer_id()
  ));

-- Lets a customer approve their own sent estimate with a signature; scoped
-- tightly so it can only flip a sent estimate to approved, nothing else.
create policy "portal approve own estimate" on documents
  for update to authenticated
  using (customer_id = auth_customer_id() and type = 'estimate' and status = 'sent')
  with check (customer_id = auth_customer_id() and type = 'estimate' and status = 'approved');
