-- 0075: online deposit on signed contracts.
--
--   documents.deposit_payment_intent_ids : the Stripe payment ids already recorded as a
--     deposit on this contract. The Stripe webhook adds one when it records an online
--     deposit, and skips a payment whose id is already here, so a replayed webhook never
--     adds the deposit twice. Never cleared by the app (clearing the deposit by hand on
--     the contract leaves it, so an old payment can't come back).
--
-- Run in Supabase AFTER the PR merges (the preview uses the live database too). Until it
-- is run, nothing offers or records an online deposit: the portal shows no Pay deposit
-- button, the contract page says "Online deposit is off until SQL 0075 is run", and
-- everything else works as before.
--
-- Additive and safe to re-run. No existing data is changed or deleted.
-- The customer login gets no access to it: SQL 0070 grants the portal role a fixed list
-- of document columns, and this column is not on it (the portal reads it on the server).

alter table documents
  add column if not exists deposit_payment_intent_ids text[];

-- So the API sees the new column right away.
notify pgrst, 'reload schema';

-- Check after running (should return one row, data_type ARRAY):
-- select column_name, data_type from information_schema.columns
--  where table_name = 'documents' and column_name = 'deposit_payment_intent_ids';
