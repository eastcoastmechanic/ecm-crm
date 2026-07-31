import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const lines = readFileSync(envPath, "utf8").split("\n");
  const env = {};
  for (const line of lines) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function main() {
  // 1. Rename "Boiler Annual Service" to clarify it's a recurring maintenance
  // plan (sits alongside HVAC Basic/Plus Plan, Multi-System Plan at the same
  // $299 flat), not a duplicate of the one-time "Boiler Tune-Up / Service".
  const { error: renameErr, count: renameCount } = await supabase
    .from("price_book_items")
    .update({ name: "Boiler Maintenance Plan (annual)" }, { count: "exact" })
    .eq("category", "Conversions & Special")
    .eq("name", "Boiler Annual Service");
  if (renameErr) throw new Error(`rename: ${renameErr.message}`);
  console.log(`Renamed Boiler Annual Service -> Boiler Maintenance Plan (annual): ${renameCount} row(s).`);

  // 2. Collapse the 291 unlabeled Daikin Parts & Supplies SKUs under $100 into
  // one flat materials-allowance line. These are bare distributor part numbers
  // (no real description survived the PDF import), so neither the AI nor a
  // human can meaningfully choose between e.g. "CFW01009" and "447-007BC" —
  // keeping 291 indistinguishable rows doesn't help quoting accuracy. The 227
  // items at $100+ are substantial, clearly distinct parts and stay itemized.
  const { data: smallParts, error: fetchErr } = await supabase
    .from("price_book_items")
    .select("id, unit_price")
    .eq("category", "Daikin Parts & Supplies")
    .lt("unit_price", 100);
  if (fetchErr) throw new Error(`fetch small parts: ${fetchErr.message}`);

  const avg = smallParts.reduce((s, r) => s + r.unit_price, 0) / smallParts.length;
  console.log(`Found ${smallParts.length} unlabeled Daikin parts under $100, average $${avg.toFixed(2)}.`);

  const ids = smallParts.map((r) => r.id);
  const { error: delErr, count: delCount } = await supabase
    .from("price_book_items")
    .delete({ count: "exact" })
    .in("id", ids);
  if (delErr) throw new Error(`delete small parts: ${delErr.message}`);
  console.log(`Deleted ${delCount} unlabeled small-part rows.`);

  const { error: insErr } = await supabase.from("price_book_items").insert({
    category: "Daikin Parts & Supplies",
    tier: null,
    name: "Misc Small Parts & Materials (per item)",
    description:
      "Flat allowance for small Daikin hardware, fittings, sensors, and incidental parts under $100 — replaces 291 individually-numbered distributor SKUs with no usable description (too numerous and unlabeled to pick between meaningfully). Priced at the real average of those parts. Adjust quantity to how many small parts the job needs.",
    unit_price: Math.round(avg * 100) / 100,
    labor_hours: null,
  });
  if (insErr) throw new Error(`insert materials allowance: ${insErr.message}`);
  console.log(`Added flat "Misc Small Parts & Materials" line at $${avg.toFixed(2)}/item.`);

  const { count: total } = await supabase
    .from("price_book_items")
    .select("id", { count: "exact", head: true });
  console.log(`Final price_book_items count: ${total}.`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
