-- 0068: one key per bot (Grok bots and other outside agents).
--   bot_keys : each bot's own key for the Field Board API. Only the SHA-256 hash is stored;
--              the key is shown once when the owner creates it on /account.
--              A bot's posts are stamped with its name, whatever `source` it sends.
--   The old shared FIELD_BOARD_SECRET / FIELD_BOARD_APP_KEY keep working until Josh removes them.
-- Additive, safe to run more than once. Server only (RLS on, no policies).

create table if not exists bot_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  token_hash text not null unique,
  token_hint text not null,
  created_at timestamptz not null default now(),
  created_by uuid references staff(id) on delete set null,
  last_used_at timestamptz,
  revoked_at timestamptz
);
-- One live key per bot name. A revoked key keeps its row for history.
create unique index if not exists bot_keys_live_name_idx on bot_keys (name) where revoked_at is null;

alter table bot_keys enable row level security;
revoke all on bot_keys from anon, authenticated;

-- Check: should return 1 row with rls = true.
select relname, relrowsecurity as rls from pg_class where relname = 'bot_keys';
