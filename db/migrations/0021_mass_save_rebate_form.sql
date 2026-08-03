-- Phase: Mass Save rebate application. A new documents.type,
-- "mass_save_rebate" — captures the exact fields the real 2026 Residential
-- Air Source Heat Pump Rebate Form needs (public/forms/mass-save-ashp-2026.pdf)
-- so it can be filled out from CRM data (customer, equipment, nameplate
-- photo scan) instead of retyped by hand. Same documents-table precedent as
-- 'assessment' (0010) and 'warranty' (0020).

alter table documents drop constraint if exists documents_type_check;
alter table documents add constraint documents_type_check
  check (type in ('estimate', 'invoice', 'proposal', 'assessment', 'warranty', 'mass_save_rebate'));
