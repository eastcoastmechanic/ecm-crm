-- Backs the MCP connector's draft-then-confirm gate for deletions, document
-- sends, and card charges. A `propose_*` tool inserts a row here and hands
-- the id back as a confirmation token; a second `confirm_action` call looks
-- it up, dispatches to the real executor, and marks it consumed. Runs on
-- Vercel (serverless, no memory between calls), so this table -- not an
-- in-process map -- is what makes the token survive between the two calls.
--
-- `consumed_at` is set only after the executor actually succeeds, not
-- before: a transient failure (a Stripe decline, a Resend hiccup) leaves the
-- token valid for retry instead of permanently burning a legitimate attempt
-- on an unrelated outage.

create table if not exists pending_actions (
  id uuid primary key default gen_random_uuid(),  -- doubles as the confirmation token

  action_name text not null,        -- registry key, e.g. 'delete_customer', 'charge_customer'
  tool_input jsonb not null,        -- the validated input the propose_* tool received, replayed verbatim to the executor on confirm
  preview text not null,            -- the human-readable preview shown at propose time

  requested_via text not null default 'mcp',

  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  consumed_at timestamptz,          -- set ONLY on a successful execution
  result text
);

-- Confirmation lookups are always by id (the primary key); this index is for
-- the "what's outstanding" question, not the hot path.
create index if not exists pending_actions_expiry_idx on pending_actions (expires_at) where consumed_at is null;

-- Internal only — same anon-role precedent as every other internal table.
alter table pending_actions enable row level security;

drop policy if exists "internal full access pending actions" on pending_actions;
create policy "internal full access pending actions" on pending_actions
  for all to anon
  using (true)
  with check (true);
