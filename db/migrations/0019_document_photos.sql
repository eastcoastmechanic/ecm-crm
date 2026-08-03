-- Lets the estimate/proposal/invoice builder attach jobsite photos or plan
-- PDFs, which get sent to Claude as vision input alongside the tech's
-- text description so line items can reflect what's actually shown.

alter table documents add column if not exists photos jsonb not null default '[]';

insert into storage.buckets (id, name, public)
values ('document-photos', 'document-photos', true)
on conflict (id) do nothing;

create policy "internal full access photos" on storage.objects
  for all to anon
  using (bucket_id = 'document-photos')
  with check (bucket_id = 'document-photos');

create policy "public read photos" on storage.objects
  for select to public
  using (bucket_id = 'document-photos');
