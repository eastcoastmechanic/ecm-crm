-- Phase: HVAC diagnostic AI + service reports. Ties an existing diagnosis to
-- the job it was performed during, adds photo capture, a sequential report
-- number (mirrors documents.doc_number), and an idempotency flag for the
-- "emailed to customer" action (mirrors documents.sent_at).

alter table diagnostics add column if not exists job_id uuid references jobs(id);
alter table diagnostics add column if not exists photos jsonb not null default '[]';
alter table diagnostics add column if not exists doc_number text;
alter table diagnostics add column if not exists report_sent_at timestamptz;

-- Photo storage. Public bucket: report PDFs/emails embed these by URL, same
-- trust model as every other table here (server-side anon key, no per-file
-- signed URLs needed).
insert into storage.buckets (id, name, public)
values ('diagnostic-photos', 'diagnostic-photos', true)
on conflict (id) do nothing;

create policy "internal full access photos" on storage.objects
  for all to anon
  using (bucket_id = 'diagnostic-photos')
  with check (bucket_id = 'diagnostic-photos');

create policy "public read photos" on storage.objects
  for select to public
  using (bucket_id = 'diagnostic-photos');
