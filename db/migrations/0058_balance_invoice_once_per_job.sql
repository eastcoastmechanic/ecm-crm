-- One balance invoice per job (PR "create the balance invoice from a finished job").
-- The Create invoice button sets balance_for_job_id. The partial unique index then lets the
-- database refuse a second live balance invoice for the same job, even if two taps race.
-- Voided invoices do not count, so a voided one can be remade. Other invoices on a job
-- (service report, deposit) leave this column empty and are not limited.
--
-- Additive. Until this is run, the button still works and falls back to checking after the insert.

alter table documents add column if not exists balance_for_job_id uuid references jobs(id) on delete set null;

create unique index if not exists documents_one_balance_invoice_per_job_idx
  on documents (balance_for_job_id)
  where balance_for_job_id is not null and status <> 'void';
