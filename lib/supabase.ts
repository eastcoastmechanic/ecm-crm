import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    // Next.js patches global fetch to cache GET requests by default; Supabase
    // reads must always hit the DB, not a stale Next.js data-cache entry.
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  },
});
