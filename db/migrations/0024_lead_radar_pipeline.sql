-- Extends the Lead Radar leads table with a manual sales-pipeline layer
-- (urgency score, town/address, quoted/won/lost stages) on top of the
-- existing automated-outreach fields (source, draft_message, auto_sendable)
-- from 0011_lead_radar.sql. Both flows share one table: automated sweeps
-- keep inserting with status 'new' and a drafted message; a human can also
-- add a lead by hand and walk it through the sales pipeline.

alter table leads add column if not exists urgency_score smallint not null default 5 check (urgency_score between 0 and 10);
alter table leads add column if not exists town text;
alter table leads add column if not exists address text;

alter table leads drop constraint if exists leads_status_check;
alter table leads add constraint leads_status_check
  check (status in ('new', 'contacted', 'quoted', 'won', 'lost', 'sent', 'dismissed'));

-- 'manual' lets a human-entered lead skip the source-specific required fields
-- (summary/channel/draft_message) that automated sweeps always populate.
alter table leads drop constraint if exists leads_source_check;
alter table leads add constraint leads_source_check
  check (source in ('web_search', 'missed_contact', 'aging_equipment', 'mls_import', 'manual'));

alter table leads alter column summary drop not null;
alter table leads alter column channel drop not null;
alter table leads alter column draft_message drop not null;

create index if not exists leads_urgency_score_idx on leads(urgency_score desc);
