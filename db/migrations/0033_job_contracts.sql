-- Job contracts: a new documents.type, "contract" — a branded, legally
-- oriented service agreement the customer e-signs in the portal before work
-- starts. Same documents-table precedent as 'warranty' (0020) and
-- 'mass_save_rebate' (0021).
--
-- signer_ip/signer_user_agent capture the signing context for any signed
-- document (contracts and estimate approvals both use them going forward) --
-- an e-signature is only worth what its audit trail can back up if a
-- signature is ever disputed.

alter table documents drop constraint if exists documents_type_check;
alter table documents add constraint documents_type_check
  check (type in ('estimate', 'invoice', 'proposal', 'assessment', 'warranty', 'mass_save_rebate', 'contract'));

alter table documents add column if not exists signer_ip text;
alter table documents add column if not exists signer_user_agent text;

-- Lets a customer sign their own sent contract, same shape as 0015's
-- "portal approve own estimate" policy — scoped so it can only flip a sent
-- contract to signed, nothing else about the row.
create policy "portal sign own contract" on documents
  for update to authenticated
  using (customer_id = auth_customer_id() and type = 'contract' and status = 'sent')
  with check (customer_id = auth_customer_id() and type = 'contract' and status = 'signed');
