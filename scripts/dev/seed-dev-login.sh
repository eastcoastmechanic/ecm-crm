#!/usr/bin/env bash
# Seeds a local-only staff user so the /login page works out of the box:
#   email:    owner@eastcoastmechanical.org
#   password: ecm-dev-password
# Idempotent: re-running just re-links the staff row. Local dev only.
set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
API_URL="${SUPABASE_API_URL:-http://127.0.0.1:54321}"
SR_KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY required}"
EMAIL="owner@eastcoastmechanical.org"
PASSWORD="ecm-dev-password"

# Reuse the existing auth user if present, otherwise create one.
uid=$(psql "$DB_URL" -tAc "select id from auth.users where email='$EMAIL' limit 1;" 2>/dev/null || true)
if [ -z "$uid" ]; then
  resp=$(curl -s -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SR_KEY" -H "Authorization: Bearer $SR_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"email_confirm\":true}")
  uid=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
fi

if [ -z "$uid" ]; then
  echo "    could not resolve/create dev auth user" >&2
  exit 1
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c \
  "insert into staff (auth_user_id, name, email, role)
   values ('$uid', 'ECM Owner', '$EMAIL', 'owner')
   on conflict (auth_user_id) do update set role = excluded.role;"

echo "    dev staff login ready: $EMAIL / $PASSWORD"
