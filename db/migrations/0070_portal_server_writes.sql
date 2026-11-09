-- 0070: the customer portal stops writing with the customer's own login.
--
-- RUN THIS AFTER the "portal server writes" PR is merged and live on
-- production. The code works before and after this runs: since that PR, every
-- portal write (approve estimate, sign contract, Request Service, linking a
-- login to its customer row) is done on the server with the service client,
-- after checking the signed-in customer owns the row. Safe to run more than once.
--
-- Why: these policies let a signed-in customer call Supabase REST directly with
-- the public anon key plus their own login and write ANY column of the row:
--   documents "portal approve own estimate"  (0015) sent estimate -> approved, but total, line_items, selected_tier... writable
--   documents "portal sign own contract"     (0033) sent contract -> signed, price, renewal price, deposit terms writable
--   jobs      "portal create service request" (0003) insert with any status, assigned tech, schedule, document, property
--   customers "portal claim customer record"  (0003) claiming could also change other columns, e.g. sms_consent
-- Some live names use underscores instead of spaces, so both spellings are dropped.
--
-- Reads (decided from the code in that PR):
--   jobs: DROPPED "portal read own jobs". The portal reads jobs on the server
--     with the service client now; a direct REST read exposed internal job notes.
--   documents: KEPT "portal read own documents", because Pay Now on an invoice
--     (createCheckoutSession) still reads the invoice with the customer's login.
--     Instead, the customer's login may only read the columns Pay Now uses plus
--     other plain fields, so line_items (with internal part costs), signatures,
--     signer IP and the raw request can't be read over REST. When Pay Now moves
--     to the service client, drop this policy and revoke select too.
--     If Pay Now ever selects a column not in the list below, add it here first.
--   customers, properties, equipment, service_contracts, diagnostics: read
--     policies unchanged (the portal pages now read these on the server anyway).
--
-- Also: one job still has the old status 'completed'; the app uses 'complete'.

begin;

-- 1. Write policies the portal no longer needs.
drop policy if exists "portal approve own estimate" on documents;
drop policy if exists "portal_approve_own_estimate" on documents;
drop policy if exists "portal sign own contract" on documents;
drop policy if exists "portal_sign_own_contract" on documents;
drop policy if exists "portal create service request" on jobs;
drop policy if exists "portal_create_service_request" on jobs;
drop policy if exists "portal claim customer record" on customers;
drop policy if exists "portal_claim_customer_record" on customers;

-- 2. Job reads by the customer's login are no longer needed.
drop policy if exists "portal read own jobs" on jobs;
drop policy if exists "portal_read_own_jobs" on jobs;

-- 3. Belt and braces: even if a policy with another name exists live, the
--    customer's login (role authenticated) gets no write access to these tables
--    and no job reads. Staff pages and the server use the service role, which
--    is not affected.
revoke insert, update, delete on documents from authenticated;
revoke all on jobs from authenticated;
revoke insert, update, delete on customers from authenticated;

-- 4. Documents: the customer's login may read only these columns.
revoke select on documents from authenticated;
grant select (id, doc_number, type, status, customer_id, property_id, job_id,
              subtotal, tax, total, selected_tier, created_at, sent_at, paid_at,
              due_date, signed_at)
  on documents to authenticated;

-- 5. Old status spelling (live count was 1).
update jobs set status = 'complete' where status = 'completed';

commit;

-- Check: expect no rows from the first query (no write policies left for the
-- portal on these tables, no job read policy), 'portal read own documents'
-- still listed by the second, false/false/false/true by the third, and 0 from
-- the last.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('documents', 'jobs', 'customers')
  and 'authenticated' = any(roles)
  and (cmd <> 'SELECT' or tablename = 'jobs');

select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'documents' and 'authenticated' = any(roles);

select
  has_table_privilege('authenticated', 'public.documents', 'SELECT') as docs_table_select,
  has_column_privilege('authenticated', 'public.documents', 'line_items', 'SELECT') as docs_line_items_select,
  has_table_privilege('authenticated', 'public.jobs', 'INSERT') as jobs_insert,
  has_column_privilege('authenticated', 'public.documents', 'total', 'SELECT') as docs_total_select;

select count(*) as completed_left from jobs where status = 'completed';
