import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Server-only client, never imported from a "use client" file — uses the
// service_role key so internal server code doesn't depend on (or need) the
// anon-key RLS policies that are also reachable from the browser via the
// portal's anon-key client.
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: {
    // Next.js patches global fetch to cache GET requests by default; Supabase
    // reads must always hit the DB, not a stale Next.js data-cache entry.
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  },
});
