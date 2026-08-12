-- Close the last two public photo buckets.
--
-- diagnostic-photos and document-photos were created public (0008, 0019):
-- anyone holding an object URL could fetch it with no login, and those objects
-- are the inside of customers' houses. 0029 put job photos in a private bucket
-- and this finishes the job for the two older ones.
--
-- Nothing needs its stored rows rewritten. Existing entries hold full public
-- URLs, and lib/photo-urls.ts parses the bucket and object path back out of
-- them to mint a signed URL at read time. That is deliberate: a bulk UPDATE
-- across years of photo JSON is not recoverable without a restore, and this
-- change stays reversible by flipping `public` back.
--
-- Read paths were converted first (see the commit that carries this file):
--   * service report PDF   - lib/service-reports.ts
--   * assessment PDF       - lib/assessment-reports.ts
--   * diagnostics detail   - app/(internal)/diagnostics/[id]/page.tsx
--   * assessment detail    - app/(internal)/documents/[id]/page.tsx
-- PDFs embed image bytes at render time, so their signatures only have to
-- outlive the render, not the finished document. Reports already emailed are
-- unaffected — the bytes are inside the PDF, not linked from it.
--
-- KNOWN EFFECT: any photo URL previously copied out of the CRM and pasted
-- somewhere else — a text to a customer, a note, an email body — stops
-- resolving the moment this runs. That is the point of the change, but it is
-- worth knowing before running it rather than after.

update storage.buckets set public = false where id in ('diagnostic-photos', 'document-photos');

-- Drop the anonymous-read grants. Reads now go through signed URLs minted
-- server-side with the service-role key, which bypass RLS for the life of the
-- signature. Both buckets' policies were created with the same name in 0008
-- and 0019, so this drops by name once and recreates nothing.
drop policy if exists "public read photos" on storage.objects;

-- The internal (service-role/anon) full-access policies from 0008 and 0019 are
-- left in place: that is how upload and signing still work.
