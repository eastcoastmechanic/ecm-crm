-- 0067: customer campaigns (issue #65). Owner sends from /campaigns.
--   campaign_templates : Josh's wording per campaign. A campaign can't send until its wording is filled in.
--   campaign_sends     : every campaign message sent, for the 30-day limit and history.
--   customers.email_opt_out_at / unsubscribe_token : email unsubscribe (every campaign email carries the link).
-- Additive, safe to run more than once. Server only (RLS on, no policies).

create table if not exists campaign_templates (
  kind text primary key check (kind in ('lapsed', 'tuneup_spring', 'tuneup_fall')),
  sms_text text,
  email_subject text,
  email_body text,
  updated_at timestamptz not null default now(),
  updated_by uuid references staff(id) on delete set null
);

create table if not exists campaign_sends (
  id bigint generated always as identity primary key,
  customer_id uuid not null references customers(id) on delete cascade,
  kind text not null,
  channel text not null check (channel in ('sms', 'email')),
  sent_at timestamptz not null default now(),
  error text
);
create index if not exists campaign_sends_customer_sent_idx on campaign_sends (customer_id, sent_at desc);

alter table customers add column if not exists email_opt_out_at timestamptz;
alter table customers add column if not exists unsubscribe_token uuid not null default gen_random_uuid();
create unique index if not exists customers_unsubscribe_token_idx on customers (unsubscribe_token);

alter table campaign_templates enable row level security;
alter table campaign_sends enable row level security;
revoke all on campaign_templates from anon, authenticated;
revoke all on campaign_sends from anon, authenticated;

-- Check: should return 6 rows.
select table_name, column_name from information_schema.columns
where (table_name = 'campaign_templates' and column_name in ('sms_text', 'email_body'))
   or (table_name = 'campaign_sends' and column_name in ('kind', 'channel'))
   or (table_name = 'customers' and column_name in ('email_opt_out_at', 'unsubscribe_token'));
