-- Deposit tracking on contracts. Terms already say "50% on signing, balance on
-- completion"; this records what was actually received so the office can see
-- the balance still owed. Nullable and additive: existing rows are untouched.
alter table documents
  add column if not exists deposit_received_cents integer,
  add column if not exists deposit_received_at date,
  add column if not exists deposit_method text;

alter table documents
  drop constraint if exists documents_deposit_method_check;
alter table documents
  add constraint documents_deposit_method_check
  check (deposit_method is null or deposit_method in ('card', 'square', 'check', 'cash', 'other'));

alter table documents
  drop constraint if exists documents_deposit_nonneg_check;
alter table documents
  add constraint documents_deposit_nonneg_check
  check (deposit_received_cents is null or deposit_received_cents >= 0);
