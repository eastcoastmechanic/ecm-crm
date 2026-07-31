-- Phase 3 of the growth/ops feature batch: field/technician operations.
-- The calendar/dispatch board and time tracking already existed
-- (JobsView.tsx's drag-to-reschedule calendar, and on_way_at ->
-- completed_at auto-computing tracked_hours) — this migration only adds
-- what was actually missing: before/after job photos and truck inventory.

alter table jobs add column if not exists photos jsonb not null default '[]';

create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  price_book_item_id uuid references price_book_items(id),
  qty_on_hand int not null default 0,
  reorder_threshold int,
  updated_at timestamptz not null default now()
);

alter table inventory_items enable row level security;
create policy "internal full access" on inventory_items for all to anon using (true) with check (true);
