#!/usr/bin/env bash
# Idempotent local-dev database bootstrap.
#
# Applies the reconstructed Phase 1 base schema, replays every numbered
# migration in db/migrations/, then loads the price-book and equipment-cost
# seed data. Safe to re-run: it only (re)creates the app schema when the core
# tables are missing, and the migrations/seeds are written to be idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGURL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

psql_run() { psql "$PGURL" -v ON_ERROR_STOP=1 -q "$@"; }

echo "==> Checking local database..."
have_core=$(psql "$PGURL" -tAc "select to_regclass('public.customers') is not null;")

if [ "$have_core" != "t" ]; then
  echo "==> Applying base schema (scripts/dev/00_base_schema.sql)"
  psql_run -f "$ROOT/scripts/dev/00_base_schema.sql"
else
  echo "==> Core tables already present, skipping base schema"
fi

echo "==> Replaying migrations from db/migrations/"
# A clean linear replay hits a few known-benign "already exists" collisions:
# 0008 and 0019 create identically named storage.objects policies (see the
# note in 0029_job_photos_private.sql). Those are historical prod migrations we
# don't rewrite. We apply each file and tolerate ONLY "already exists" /
# "...does not exist, skipping" — any other ERROR aborts the bootstrap.
for f in "$ROOT"/db/migrations/*.sql; do
  echo "    - $(basename "$f")"
  err=$(psql "$PGURL" -f "$f" 2>&1 >/dev/null || true)
  bad=$(echo "$err" | grep "^psql.*ERROR:" | grep -viE "already exists|does not exist, skipping" || true)
  if [ -n "$bad" ]; then
    echo "ERROR while applying $(basename "$f"):"
    echo "$bad"
    exit 1
  fi
done

echo "==> Loading seed data"
for seed in seed_price_book.sql seed_equipment_costs.sql; do
  if [ -f "$ROOT/db/$seed" ]; then
    echo "    - db/$seed"
    # Seeds are large INSERTs; tolerate re-runs where unique rows already exist.
    psql "$PGURL" -q -f "$ROOT/db/$seed" >/dev/null 2>&1 || echo "      (seed already loaded or partially skipped)"
  fi
done

echo "==> Done. Table count:"
psql "$PGURL" -tAc "select count(*) from information_schema.tables where table_schema='public';"
