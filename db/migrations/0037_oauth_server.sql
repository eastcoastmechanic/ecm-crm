-- Hand-rolled OAuth 2.1 + PKCE + DCR authorization server backing the MCP
-- connector (app/api/oauth/*, app/.well-known/oauth-*). Single user (Josh)
-- -- claude.ai's custom-connector UI only exposes an OAuth Client ID/Secret
-- field with no plain-bearer-token option and requires the server to
-- support Dynamic Client Registration, which the static-MCP_API_KEY-only
-- setup (still kept working unchanged for direct/CLI callers) can't satisfy
-- from that surface.
--
-- Deliberately NOT using this schema's usual "internal full access to anon"
-- RLS policy on these three tables. Every app/api/oauth/* route reads these
-- through lib/supabase.ts's service-role client, which bypasses RLS
-- entirely -- so an anon policy here buys the app nothing, while
-- NEXT_PUBLIC_SUPABASE_ANON_KEY *is* shipped to the browser (see
-- lib/supabase-portal/client.ts). An anon-writable oauth_tokens would let
-- anyone holding that public key INSERT a token_hash of their own choosing
-- and authenticate to /api/mcp directly, skipping login and PKCE entirely.
-- RLS stays enabled with no policy, i.e. default-deny for anon.

create table if not exists oauth_clients (
  client_id uuid primary key default gen_random_uuid(),  -- doubles as the DCR-returned client_id (RFC 7591)
  client_name text,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

alter table oauth_clients enable row level security;
drop policy if exists "internal full access oauth clients" on oauth_clients;

-- Single-use, short-lived authorization codes, bound to the exact
-- client_id + redirect_uri + code_challenge presented at /authorize so
-- /token can re-verify all three before ever issuing a token. `code` is a
-- high-entropy random string generated in app code, not a uuid -- it's the
-- bearer credential of this row, not a surrogate key.
create table if not exists oauth_authorization_codes (
  code text primary key,
  client_id uuid not null references oauth_clients (client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz  -- set atomically by /api/oauth/token's UPDATE ... WHERE consumed_at IS NULL ... RETURNING
);

create index if not exists oauth_authorization_codes_expiry_idx
  on oauth_authorization_codes (expires_at) where consumed_at is null;

alter table oauth_authorization_codes enable row level security;
drop policy if exists "internal full access oauth authorization codes" on oauth_authorization_codes;

-- Issued access + refresh tokens, stored hashed -- never plaintext -- so a
-- DB read doesn't hand out usable credentials directly. `family_id` stays
-- constant across a refresh token's whole rotate-on-use lineage; presenting
-- an already-consumed refresh token revokes every row sharing its
-- family_id (OAuth 2.1 reuse-detection guidance).
create table if not exists oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  token_type text not null check (token_type in ('access', 'refresh')),
  client_id uuid not null references oauth_clients (client_id) on delete cascade,
  family_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists oauth_tokens_family_idx on oauth_tokens (family_id);
create index if not exists oauth_tokens_expiry_idx
  on oauth_tokens (expires_at) where revoked_at is null;

alter table oauth_tokens enable row level security;
drop policy if exists "internal full access oauth tokens" on oauth_tokens;
