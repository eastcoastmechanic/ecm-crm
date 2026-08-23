-- price_book_items had no uniqueness guarantee on name, so a racy
-- check-then-insert (see app/api/admin/price-book-import/route.ts) let the
-- Aug 16 Daikin/Goodman catalog import double- and triple-insert the same
-- SKU when called concurrently: existingNames was read once per request,
-- so parallel requests all saw the same "not yet inserted" set and all
-- inserted it. Confirmed live: e.g. "Goodman Furnaces GD9S801005CNA*"
-- has 4 identical rows.
--
-- Two partial indexes because tiered items (tier = good/better/best) are
-- meant to share a name across tiers -- e.g. "2-Zone System" has three
-- rows, one per tier -- while flat catalog items (tier is null) should
-- never repeat a name at all.
--
-- Run this only after the existing duplicate rows are cleaned up --
-- a unique index can't be created while duplicates still violate it.

create unique index if not exists price_book_items_flat_name_uniq
  on price_book_items (name)
  where tier is null;

create unique index if not exists price_book_items_tiered_name_tier_uniq
  on price_book_items (name, tier)
  where tier is not null;
