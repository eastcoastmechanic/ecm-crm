-- ECM Platform — consolidated current schema (reference only).
-- This file is a snapshot of what the live database looks like after
-- db/migrations/0001 through 0011 have all been applied — it is NOT itself
-- run against the database. The migrations in db/migrations/ are the actual
-- source of truth for how the schema got here and why; this file exists so
-- a fresh read gives an accurate picture without having to replay all 11
-- migration diffs by hand.
--
-- Multi-tenant ready via company_id, even though v1 is single-tenant (ECM only).

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  name text not null,
  email text,
  phone text,
  billing_address text,
  notes text,
  created_at timestamptz default now(),
  auth_user_id uuid references auth.users(id),        -- 0003: links to portal login
  sms_consent boolean not null default true,          -- 0009: real opt-in flag (A2P compliance)
  sms_consent_at timestamptz
);
create unique index customers_auth_user_id_key on customers(auth_user_id);

create table properties (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  address text not null,
  property_type text, -- residential / commercial
  created_at timestamptz default now()
);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id),
  type text not null,          -- e.g. mini-split, boiler, tankless water heater
  brand text,
  model text,
  serial_number text,
  install_date date,
  warranty_expiration date,
  refrigerant_type text,
  notes text,
  created_at timestamptz default now()
);

create table service_contracts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  property_id uuid references properties(id),
  plan_name text,
  start_date date,
  end_date date,
  status text default 'active',
  terms text,
  created_at timestamptz default now(),
  renewal_reminder_sent_at timestamptz  -- 0004
);

create table price_book_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  category text,
  tier text,          -- good / better / best
  name text not null,
  description text,
  unit_price numeric(10,2),
  labor_hours numeric(5,2),
  created_at timestamptz default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  doc_number text,             -- e.g. EST-1001, INV-1001, PROP-1001, CA-1001
  type text not null check (type in ('estimate', 'invoice', 'proposal', 'assessment')), -- 0010 added 'assessment'
  customer_id uuid references customers(id),
  property_id uuid references properties(id),
  status text default 'draft', -- draft / sent / approved / paid
  line_items jsonb not null,   -- shape varies by type: tiered good/better/best items, or (for
                                -- 'assessment') { items: [...], overall_summary }
  subtotal numeric(10,2),
  tax numeric(10,2),
  total numeric(10,2),
  ai_generated boolean default true,
  raw_request text,             -- the original text/voice input from the tech
  created_at timestamptz default now(),
  sent_at timestamptz,
  paid_at timestamptz,
  due_date date,                        -- 0004
  last_reminder_sent_at timestamptz     -- 0004
);

create table diagnostics (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid references equipment(id),
  readings jsonb,               -- {superheat, subcooling, static_pressure, amp_draw, ...}
  ai_diagnosis text,
  suggested_fix text,
  suggested_line_items jsonb,
  created_at timestamptz default now(),
  job_id uuid references jobs(id),           -- 0008
  photos jsonb not null default '[]',        -- 0008
  doc_number text,                           -- 0008, e.g. RPT-1001
  report_sent_at timestamptz                 -- 0008
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  property_id uuid references properties(id),
  scheduled_at timestamptz,
  status text default 'scheduled', -- requested / scheduled / in_progress / complete / cancelled
  document_id uuid references documents(id),
  created_at timestamptz default now(),
  notes text,                                     -- 0003
  completed_at timestamptz,                       -- 0004
  follow_up_sent_at timestamptz,                   -- 0004
  on_way_at timestamptz,                           -- 0005
  tracked_hours numeric(6,2),                      -- 0005
  reminder_sent_at timestamptz,                    -- 0005
  ics_sequence integer not null default 0,         -- 0005
  created_via text not null default 'manual'       -- 0006: manual / ai_sms / ai_voice / portal
);

-- Wholesale distributor cost by brand/model. Internal/ECM-facing only —
-- never expose this table to the customer portal.
create table equipment_costs (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model_number text not null,
  cost numeric(10,2) not null,
  created_at timestamptz default now(),
  unique (brand, model_number)
);

-- 0006/0007: AI receptionist (SMS + voice). One row per phone thread (SMS)
-- or per call (voice, keyed by call_sid). 0012 added the website chatbot
-- channel, keyed by session_id instead since a web visitor has no phone
-- number until/unless they give one while booking.
create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'sms',
  phone_number text,                            -- 0012: made nullable for web channel
  customer_id uuid references customers(id),
  status text not null default 'open',
  transcript jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  call_sid text,
  session_id text                                -- 0012: web channel thread key
);
create index ai_conversations_phone_idx on ai_conversations(phone_number);
create unique index ai_conversations_call_sid_idx on ai_conversations(call_sid) where call_sid is not null;
create unique index ai_conversations_session_idx on ai_conversations(session_id) where session_id is not null;

-- 0011: Lead Radar. Automated sweeps (web search, missed inbound contacts,
-- aging equipment on existing customers, MLS-sourced recently-sold-home
-- imports) populate this with a drafted outreach message. Only rows with
-- auto_sendable = true (existing, consented customers) may ever be
-- auto-sent through Twilio/Resend — everything else is draft-only.
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

-- 0013: Staff to-do list with reminders. Freestanding by default;
-- optionally linked to a customer or job for context. created_via
-- distinguishes manual UI entries from ones the internal AI assistant
-- created via its add_task tool.
create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  due_at timestamptz,
  completed_at timestamptz,
  reminder_sent_at timestamptz,
  customer_id uuid references customers(id),
  job_id uuid references jobs(id),
  created_via text not null default 'manual', -- manual / ai_chat
  created_at timestamptz not null default now()
);
create index tasks_due_at_idx on tasks(due_at);

-- Storage: public bucket used for diagnostic/condition-assessment photos
-- (0008). Server-side anon key trust model, same as every table here — no
-- per-file signed URLs.
-- insert into storage.buckets (id, name, public) values ('diagnostic-photos', 'diagnostic-photos', true);

-- RLS: every table above has "internal full access" (all ops, role anon).
-- 0003 additionally scopes read-only policies to the `authenticated` role
-- for the customer portal (own-customer-only, via auth_customer_id()):
--   customers (claim + read own), properties, equipment, service_contracts,
--   documents (status <> 'draft' only), jobs (read + portal-submitted insert).
-- See db/migrations/0003_portal_auth.sql for the exact policy definitions.
