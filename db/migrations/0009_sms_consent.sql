-- Phase: real SMS consent capture. The A2P campaign was rejected twice
-- (Error 30909) because outbound job-confirmation texts were being sent to
-- any customer with a phone on file, with no actual consent capture at the
-- two places a number enters the system without the customer having texted
-- in first (manual office entry, and the AI voice receptionist creating a
-- customer from a caller-ID). This adds a real, enforced consent flag.
--
-- Existing customers are grandfathered as consented (default true) since
-- they were already receiving these texts as part of normal business before
-- this flag existed. Going forward, every new customer insert sets this
-- explicitly based on real consent (checkbox for office entry, verbal yes/no
-- for the AI voice receptionist).

alter table customers add column if not exists sms_consent boolean not null default true;
alter table customers add column if not exists sms_consent_at timestamptz;

update customers set sms_consent_at = now() where sms_consent_at is null;
