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

const identicalTierNames = [
  ["Boilers", "Boiler Tune-Up / Service"],
  ["Boilers", "Gas Pressure Test / Inspection"],
  ["Conversions & Special", "Boiler Annual Service"],
  ["Conversions & Special", "HVAC Basic Plan (1 system)"],
  ["Conversions & Special", "HVAC Plus Plan (1 system)"],
  ["Conversions & Special", "Multi-System Plan (per add'l sys)"],
  ["Conversions & Special", "Plumbing Annual Inspection"],
  ["Ducted HVAC", "Refrigerant Recovery — R-410A"],
  ["Ductless Mini-Split", "Extended Lineset Run (over 50')"],
  ["Ductless Mini-Split", "Kumo Cloud / WiFi Adapter Install"],
  ["Ductless Mini-Split", "Mini-Split System Commissioning / Startup"],
  ["Ductless Mini-Split", "Refrigerant Recovery (existing system)"],
  ["Ductwork", "Foil Tape (per roll applied)"],
  ["Plumbing", "Drain Line Repair — Per Hour + Material"],
  ["Plumbing", "Water Pressure Test"],
];

const permits = [
  ["Boilers", "Permit — Boiler / Gas Work", 500],
  ["Ducted HVAC", "Permit (estimated Plymouth/South Shore)", 450],
  ["Ductless Mini-Split", "Permit (town-dependent, est.)", 450],
  ["Water Heaters", "Permit — Water Heater", 225],
];

const newItems = [
  {
    category: "Boilers",
    tier: null,
    name: "Diagnostic / Service Call — Heating",
    description:
      "Trip fee plus first 30-60 min on-site diagnosis; applied toward repair cost if same-visit work proceeds.",
    unit_price: 99,
    labor_hours: null,
  },
  {
    category: "Ducted HVAC",
    tier: null,
    name: "Diagnostic / Service Call — Cooling / Heat Pump",
    description:
      "Trip fee plus first 30-60 min on-site diagnosis; applied toward repair cost if same-visit work proceeds.",
    unit_price: 99,
    labor_hours: null,
  },
  {
    category: "Ductless Mini-Split",
    tier: null,
    name: "Diagnostic / Service Call",
    description:
      "Trip fee plus first 30-60 min on-site diagnosis; applied toward repair cost if same-visit work proceeds.",
    unit_price: 99,
    labor_hours: null,
  },
  {
    category: "Plumbing",
    tier: null,
    name: "Diagnostic / Service Call — Plumbing",
    description:
      "Trip fee plus first 30-60 min on-site diagnosis; applied toward repair cost if same-visit work proceeds.",
    unit_price: 125,
    labor_hours: null,
  },
];

async function main() {
  let deleted = 0;
  let updated = 0;

  for (const [category, name] of identicalTierNames) {
    const { error: delErr, count } = await supabase
      .from("price_book_items")
      .delete({ count: "exact" })
      .eq("category", category)
      .eq("name", name)
      .in("tier", ["better", "best"]);
    if (delErr) throw new Error(`delete ${category}/${name}: ${delErr.message}`);
    deleted += count ?? 0;

    const { error: updErr, count: updCount } = await supabase
      .from("price_book_items")
      .update({ tier: null }, { count: "exact" })
      .eq("category", category)
      .eq("name", name)
      .eq("tier", "good");
    if (updErr) throw new Error(`update ${category}/${name}: ${updErr.message}`);
    updated += updCount ?? 0;
  }
  console.log(`Identical-tier collapse: ${deleted} rows deleted, ${updated} rows flattened.`);

  const { error: dupErr, count: dupCount } = await supabase
    .from("price_book_items")
    .delete({ count: "exact" })
    .eq("category", "Water Heaters")
    .eq("name", "Thermal Expansion Tank");
  if (dupErr) throw new Error(`delete duplicate expansion tank: ${dupErr.message}`);
  console.log(`Duplicate expansion tank removed: ${dupCount ?? 0} row(s).`);

  let permitUpdated = 0;
  let permitDeleted = 0;
  for (const [category, name, flat] of permits) {
    const { error: updErr, count: updCount } = await supabase
      .from("price_book_items")
      .update({ unit_price: flat, tier: null }, { count: "exact" })
      .eq("category", category)
      .eq("name", name)
      .eq("tier", "good");
    if (updErr) throw new Error(`update permit ${category}/${name}: ${updErr.message}`);
    permitUpdated += updCount ?? 0;

    const { error: delErr, count: delCount } = await supabase
      .from("price_book_items")
      .delete({ count: "exact" })
      .eq("category", category)
      .eq("name", name)
      .in("tier", ["better", "best"]);
    if (delErr) throw new Error(`delete permit ${category}/${name}: ${delErr.message}`);
    permitDeleted += delCount ?? 0;
  }
  console.log(`Permits flattened: ${permitUpdated} rows updated, ${permitDeleted} rows deleted.`);

  const { error: insErr, count: insCount } = await supabase
    .from("price_book_items")
    .insert(newItems, { count: "exact" });
  if (insErr) throw new Error(`insert diagnostic fees: ${insErr.message}`);
  console.log(`Diagnostic/service-call items added: ${insCount ?? newItems.length}.`);

  const { count: total } = await supabase
    .from("price_book_items")
    .select("id", { count: "exact", head: true });
  console.log(`Final price_book_items count: ${total}.`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
