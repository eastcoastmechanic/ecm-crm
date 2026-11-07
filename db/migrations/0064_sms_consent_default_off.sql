-- 0064: new customers start with texting OFF. A customer is texted only after
-- someone ticks the consent box (or they text START / sign up). Before this,
-- the column defaulted to true, so a customer added without the box (the chat
-- assistant's add_customer) was treated as agreeing. Safe to run more than once.
alter table customers alter column sms_consent set default false;

-- Check: should return false.
select column_default from information_schema.columns
where table_name = 'customers' and column_name = 'sms_consent';

-- OPTIONAL, Josh's call. Customers with texting on but no consent time got it
-- from the old default, not a ticked box (4 at 2026-11-06). Look first:
--   select id, name, phone, created_at from customers
--   where sms_consent = true and sms_consent_at is null;
-- To turn texting off for them, run:
--   update customers set sms_consent = false
--   where sms_consent = true and sms_consent_at is null;
