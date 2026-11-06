-- 0062: the Good / Better / Best option a customer picked when approving an
-- estimate in the portal. Own column so approving never rewrites line_items.
-- Null = flat estimate, or approved before this existed (Better is assumed).
-- Safe to run more than once.
alter table documents
  add column if not exists selected_tier text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_selected_tier_check') then
    alter table documents
      add constraint documents_selected_tier_check
      check (selected_tier is null or selected_tier in ('good', 'better', 'best'));
  end if;
end $$;
