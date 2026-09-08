-- A document delete was failing on jobs_document_id_fkey even after the app
-- tried to null jobs.document_id first. Make the database do that itself so a
-- leftover job pointer can never block deleting an estimate/invoice.
alter table jobs drop constraint if exists jobs_document_id_fkey;
alter table jobs
  add constraint jobs_document_id_fkey
  foreign key (document_id) references documents(id) on delete set null;

alter table diagnostics drop constraint if exists diagnostics_invoice_document_id_fkey;
alter table diagnostics
  add constraint diagnostics_invoice_document_id_fkey
  foreign key (invoice_document_id) references documents(id) on delete set null;
