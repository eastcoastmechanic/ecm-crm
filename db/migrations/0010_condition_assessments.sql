-- Phase: equipment condition assessment reports. A new documents.type,
-- "assessment" — a whole-property equipment health/condition report,
-- distinct from the diagnostics table's fault-driven "service report"
-- (RPT-####). Lives in documents to reuse its numbering/PDF/email
-- infrastructure. line_items stays untyped jsonb; assessment rows just use
-- a per-equipment array shape instead of the tiered-pricing shape.

alter table documents drop constraint if exists documents_type_check;
alter table documents add constraint documents_type_check
  check (type in ('estimate', 'invoice', 'proposal', 'assessment'));
