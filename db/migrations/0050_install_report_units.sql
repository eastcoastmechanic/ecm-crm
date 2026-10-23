-- 0050_install_report_units.sql
-- An install can have several indoor/outdoor units. Each entry:
-- { "label", "type", "brand", "model", "serial", "refrigerant_type", "lineset_size", "lineset_ft" }
-- The older single-unit columns stay and hold the first unit, so existing reports and lists keep working.
alter table install_reports add column if not exists units jsonb not null default '[]';
