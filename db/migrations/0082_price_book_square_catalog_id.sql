-- Square catalog import into the price book. Run in the Supabase SQL editor.
-- (If another PR already used 0082 by the time this merges, rename the file to the next free number.)
--
-- Each price book row copied from Square keeps the Square item variation id here, so running
-- "Import from Square catalog" again skips it even if the row is renamed in the CRM.
-- Rows typed into the CRM by hand leave it empty.
--
-- Additive and safe to run more than once. Before it runs, the Preview on /price-book still works
-- (it matches by name only) but the Import button stays off.

alter table price_book_items
  add column if not exists square_catalog_object_id text;

-- One price book row per Square variation.
create unique index if not exists price_book_items_square_catalog_object_id_idx
  on price_book_items (square_catalog_object_id)
  where square_catalog_object_id is not null;

-- Check: should return one row.
-- select column_name from information_schema.columns
--  where table_name = 'price_book_items' and column_name = 'square_catalog_object_id';
