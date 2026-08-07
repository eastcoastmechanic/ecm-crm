-- Tech Hub: parts-used to price book. The AI's suggested_line_items on a
-- diagnostic only ever matches the price book by a free-text name (no real
-- FK) -- this column captures what the tech actually confirms/uses,
-- resolved against real price_book_items, so it can drive an accurate
-- inventory deduction.
-- [{ "price_book_item_name": "...", "qty": 1, "unit_price": 129.00 }]
alter table diagnostics add column if not exists actual_parts_used jsonb not null default '[]';
