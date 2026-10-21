-- Estimates-to-review inbox: records where Josh sent each bot estimate.
-- routed_to is null until he taps "Create in CRM" or "Create in Square".
alter table documents
  add column if not exists routed_to text check (routed_to in ('crm', 'square'));

alter table documents
  add column if not exists routed_at timestamptz;

create index if not exists documents_unrouted_estimates_idx
  on documents (created_at desc)
  where routed_to is null and type = 'estimate' and status = 'draft';
