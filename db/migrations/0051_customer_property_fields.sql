-- 0051_customer_property_fields.sql
-- Extra contact and site details the office and the truck need on the record.
alter table customers add column if not exists company_name text;
alter table customers add column if not exists alt_phone text;
alter table properties add column if not exists access_notes text;  -- gate code, pets, parking, lockbox
