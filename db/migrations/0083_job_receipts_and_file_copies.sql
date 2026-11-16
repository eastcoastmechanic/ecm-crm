-- 0083: receipts on a job, and a record of each job file copied to the SharePoint job folder.
-- (Number may need bumping if another PR used 0083 first.)
--
--   job-receipts bucket : receipt photos and PDFs. PRIVATE, like job-photos (0029). No anon or
--                         public policy at all: the app uploads and signs links with the service
--                         role, which does not need one.
--   job_receipts        : one row per receipt (vendor, amount paid, date, short note, the file).
--                         Amounts are office-only; the app never sends them to a tech's screen.
--   job_file_copies     : one row per job file (photo or receipt) that should also be in the
--                         property's SharePoint folder (Job Notes / "<street> <town>"), with how
--                         that copy went. Lets a retry pick up anything SharePoint refused.
--
-- Additive and safe to re-run. No existing data is changed or deleted.
-- Internal only: RLS on with no policy; the server uses the service role (same as 0065).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-receipts', 'job-receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false;

create table if not exists job_receipts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  vendor text not null check (length(btrim(vendor)) > 0),
  amount_cents integer check (amount_cents is null or amount_cents >= 0),
  purchased_on date,
  note text,
  file_path text not null,
  file_name text,
  content_type text,
  uploaded_by_staff_id uuid references staff(id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists job_receipts_job_id_idx on job_receipts (job_id, created_at);

alter table job_receipts enable row level security;
revoke all on job_receipts from anon, authenticated;

create table if not exists job_file_copies (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  kind text not null check (kind in ('photo', 'receipt')),
  bucket text not null,
  path text not null,
  receipt_id uuid references job_receipts(id) on delete cascade,
  -- Extra bits for the file name in SharePoint (photo phase, receipt vendor). Never money.
  label text,
  status text not null default 'pending' check (status in ('pending', 'copied', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  sharepoint_item_id text,
  sharepoint_url text,
  created_at timestamptz not null default now(),
  copied_at timestamptz,
  unique (bucket, path)
);

create index if not exists job_file_copies_job_status_idx on job_file_copies (job_id, status);

alter table job_file_copies enable row level security;
revoke all on job_file_copies from anon, authenticated;

-- Check: should list the bucket as public = false, and both tables.
select id, public from storage.buckets where id = 'job-receipts';
select table_name from information_schema.tables where table_name in ('job_receipts', 'job_file_copies');
