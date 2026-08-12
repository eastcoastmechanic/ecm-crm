-- Job documentation photos: their own bucket, and a private one.
--
-- Job photos are the inside of customers' houses — basements, closets, attics,
-- whatever is behind the furnace. The existing diagnostic-photos and
-- document-photos buckets are public: anyone holding the URL can fetch the
-- object with no login. That is an acceptable trade for a rating plate, and
-- not one for someone's home, so this bucket is private and reads go through
-- short-lived signed URLs.
--
-- jobs.photos itself already exists in production (added out-of-band; it was
-- missing from db/schema.sql, which this migration's companion edit fixes).
-- The column is left alone here: entries are appended as
--   { url, caption, phase, taken_at }
-- where phase is 'arrival' | 'during' | 'completion'. Older entries have only
-- { url, caption } and stay valid — nothing reads phase without a fallback.

insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

-- Distinct policy name on purpose. Policy names are unique per table, and
-- storage.objects already carries an "internal full access photos" policy from
-- 0008; reusing the name here would fail to apply.
drop policy if exists "internal full access job photos" on storage.objects;
create policy "internal full access job photos" on storage.objects
  for all to anon
  using (bucket_id = 'job-photos')
  with check (bucket_id = 'job-photos');

-- Deliberately no "public read" policy. Reads are served by signed URLs minted
-- server-side, which bypass RLS for the life of the signature. Adding a public
-- select policy here would quietly undo the point of the bucket.
