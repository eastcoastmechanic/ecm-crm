-- Phase: Lead Radar. Automated sweeps (web/social search, missed inbound
-- contacts that never converted, aging equipment on existing customers,
-- MLS-sourced recently-sold-home imports) populate this table with a
-- drafted outreach message. Per the TCPA/CAN-SPAM constraint that shaped the
-- SMS consent work (0009), only rows where consent already exists
-- (aging_equipment tied to a consented/known customer) may ever be
-- auto-sent through Twilio/Resend. Everything else is a task: Claude
-- drafts, a human sends.

create table leads (
  id uuid primary key default gen_random_uuid(),

  source text not null check (source in ('web_search', 'missed_contact', 'aging_equipment', 'mls_import')),
  status text not null default 'new' check (status in ('new', 'contacted', 'sent', 'dismissed')),

  customer_id uuid references customers(id),
  equipment_id uuid references equipment(id),
  phone_number text,

  contact_name text,
  contact_info text,        -- freeform: "reply to u/username's Reddit thread", a publicly posted email, a property address, etc.
  source_url text,          -- web_search leads only

  summary text not null,
  channel text not null check (channel in ('sms', 'email', 'reply_to_post', 'call', 'mail', 'none')),
  draft_message text not null,

  auto_sendable boolean not null default false,
  sent_at timestamptz,
  contacted_at timestamptz,
  dismissed_at timestamptz,

  created_at timestamptz not null default now()
);

create unique index leads_source_url_idx on leads(source_url) where source_url is not null;
create unique index leads_missed_contact_phone_idx on leads(phone_number) where source = 'missed_contact';
create unique index leads_equipment_idx on leads(equipment_id) where equipment_id is not null;
create unique index leads_mls_address_idx on leads(contact_info) where source = 'mls_import';

create index leads_status_idx on leads(status);
create index leads_created_at_idx on leads(created_at desc);

alter table leads enable row level security;
create policy "internal full access" on leads for all to anon using (true) with check (true);
