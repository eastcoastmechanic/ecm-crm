-- Web push alerts for techs (plan v3, Phase 1): one row per phone/browser a person turned alerts on for.
-- endpoint is unique, so turning alerts on twice on the same phone just refreshes the row.
-- A subscription the push service reports as gone (404/410) is deleted by the sender.
--
-- Additive. Internal only: RLS on with no anon policy; the server uses the service role.
-- Needs VAPID keys on Vercel to actually send (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
-- NEXT_PUBLIC_VAPID_PUBLIC_KEY). Without them alerts quietly fall back to email and Teams only.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists push_subscriptions_staff_idx on push_subscriptions (staff_id);

alter table push_subscriptions enable row level security;
