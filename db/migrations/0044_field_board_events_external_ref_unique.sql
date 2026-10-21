-- A retried Field Board / bot POST must not log the same event (and append the
-- same note to the job) twice. external_ref is optional, so only enforce when set.

-- Collapse any existing repeats first (keep the earliest), or the index can't build.
delete from field_board_events a
using field_board_events b
where a.external_ref is not null
  and a.source = b.source
  and a.external_ref = b.external_ref
  and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists field_board_events_source_external_ref_key
  on field_board_events (source, external_ref)
  where external_ref is not null;
