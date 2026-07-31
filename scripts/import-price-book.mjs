// One-off import of the real Daikin/Goodman distributor cost data
// (scripts/data/pricing-flat-file.json, exported from the dealer's
// "Pricing Flat File" spreadsheet) into price_book_items, marked up 30%
// over cost per the owner's standing pricing rule. Re-run is safe to do
// against a fresh environment but will duplicate rows if run twice against
// the same database — this is a one-time load, not an idempotent migration.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(root, ".env.local");
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const MARKUP = 1.3;

function markup(cost) {
  return Math.round(Number(cost) * MARKUP * 100) / 100;
}

async function main() {
  const rows = JSON.parse(readFileSync(path.join(__dirname, "data", "pricing-flat-file.json"), "utf8"));

  const items = rows.map((row) => ({
    category: row.Brand,
    tier: null,
    name: `${row.Brand} ${row.Model}`,
    description: null,
    unit_price: markup(row.Cost),
    labor_hours: null,
  }));

  console.log(`Importing ${items.length} price book items (cost × ${MARKUP})...`);

  const BATCH_SIZE = 200;
  let inserted = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase.from("price_book_items").insert(batch, { count: "exact" });
    if (error) {
      console.error(`Batch starting at ${i} failed:`, error.message);
      process.exit(1);
    }
    inserted += count ?? batch.length;
    console.log(`  inserted ${inserted}/${items.length}`);
  }

  console.log(`Done. Inserted ${inserted} price book items.`);
}

main();
