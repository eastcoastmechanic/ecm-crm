-- Phase 4: customer portal auth.
-- Links a customers row to a Supabase Auth user (magic-link login), and
-- scopes RLS so portal (authenticated) users can only ever see their own
-- data. The internal app keeps using the anon key exactly as before —
-- these policies only tighten access for the NEW authenticated role.

alter table customers add column if not exists auth_user_id uuid references auth.users(id);
create unique index if not exists customers_auth_user_id_key on customers(auth_user_id);

-- Free-text description for portal-submitted service requests.
alter table jobs add column if not exists notes text;

-- Resolves the customers.id row for the currently signed-in portal user.
create or replace function auth_customer_id() returns uuid
language sql stable
as $$
  select id from customers where auth_user_id = auth.uid()
$$;

-- The Phase 1 "allow everything" policies applied to every role (no TO
-- clause = PUBLIC). Recreate them scoped to anon only now that
-- authenticated portal users exist, so a customer login can't fall back
-- to full access.
drop policy "internal full access" on companies;
drop policy "internal full access" on customers;
drop policy "internal full access" on properties;
drop policy "internal full access" on equipment;
drop policy "internal full access" on service_contracts;
drop policy "internal full access" on price_book_items;
drop policy "internal full access" on documents;
drop policy "internal full access" on diagnostics;
drop policy "internal full access" on jobs;
drop policy "internal full access" on equipment_costs;

create policy "internal full access" on companies for all to anon using (true) with check (true);
create policy "internal full access" on customers for all to anon using (true) with check (true);
create policy "internal full access" on properties for all to anon using (true) with check (true);
create policy "internal full access" on equipment for all to anon using (true) with check (true);
create policy "internal full access" on service_contracts for all to anon using (true) with check (true);
create policy "internal full access" on price_book_items for all to anon using (true) with check (true);
create policy "internal full access" on documents for all to anon using (true) with check (true);
create policy "internal full access" on diagnostics for all to anon using (true) with check (true);
create policy "internal full access" on jobs for all to anon using (true) with check (true);
create policy "internal full access" on equipment_costs for all to anon using (true) with check (true);

-- One-time self-service linking: a freshly authenticated user may claim
-- the customer row matching their verified login email, only while it's
-- unclaimed, and only to set their own auth.uid().
create policy "portal claim customer record" on customers
  for update to authenticated
  using (email = auth.jwt() ->> 'email' and auth_user_id is null)
  with check (auth_user_id = auth.uid());

create policy "portal read own customer" on customers
  for select to authenticated
  using (auth_user_id = auth.uid());

create policy "portal read own properties" on properties
  for select to authenticated
  using (customer_id = auth_customer_id());

create policy "portal read own equipment" on equipment
  for select to authenticated
  using (property_id in (select id from properties where customer_id = auth_customer_id()));

create policy "portal read own contracts" on service_contracts
  for select to authenticated
  using (customer_id = auth_customer_id());

-- Drafts haven't been reviewed/sent yet — never expose them to the portal.
create policy "portal read own documents" on documents
  for select to authenticated
  using (customer_id = auth_customer_id() and status <> 'draft');

create policy "portal read own jobs" on jobs
  for select to authenticated
  using (customer_id = auth_customer_id());

create policy "portal create service request" on jobs
  for insert to authenticated
  with check (customer_id = auth_customer_id());
