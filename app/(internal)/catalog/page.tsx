import { supabase } from "@/lib/supabase";
import { fetchAllPriceBookItems } from "@/lib/price-book";
import CatalogApp, { type CatalogItem } from "./CatalogApp";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  category: string | null;
  name: string;
  description: string | null;
  unit_price: number | null;
  tier: string | null;
};

function enrich(row: Row): CatalogItem | null {
  if (row.unit_price == null) return null;
  const model = row.name.trim();
  if (!model) return null;
  const note = row.description?.trim() || null;
  const cat = (row.category || "").toLowerCase();
  const u = model.toUpperCase();

  let kind = "equipment";
  if (/part|supply|filter|fitting|wire|copper|line set/i.test(cat) || cat.includes("parts")) {
    kind = "part";
  } else if (/^([2-5])MX/i.test(u) || u.startsWith("MXZ")) {
    kind = "outdoor_multi";
  } else if (/^(RX|RXM|RXL|RXN)/i.test(u)) {
    kind = "outdoor_single";
  } else if (/^(FTX|CTX|FFQ|FDMQ|FVXS|CDXS)/i.test(u) || /head|wall mount|indoor/i.test(cat + " " + (note || ""))) {
    kind = "indoor_head";
  }

  let kbtu: number | null = null;
  const km = u.replace(/\*/g, "").match(/(\d{2})(?=[A-Z]|$)/);
  if (km) {
    const n = parseInt(km[1], 10);
    if (n >= 7 && n <= 60) kbtu = n;
  }

  let ports: number | null = null;
  const pm = u.match(/^([2-5])MX/);
  if (pm) ports = parseInt(pm[1], 10);

  let series: string | null = null;
  if (u.includes("MXTH")) series = "MXTH";
  else if (u.includes("MXT")) series = "MXT";
  else if (u.includes("MXM")) series = "MXM";

  let brand = "Other";
  if (/daikin|ftx|ctx|mxm|mxt|mxth|rxm|rx /i.test(model + cat)) brand = "Daikin";
  else if (/goodman|glx|gmv|gph|gsh|amv|ahv/i.test(model + cat)) brand = "Goodman";
  else if (kind === "part") brand = "Parts";

  return {
    id: row.id,
    model,
    brand,
    sell: Number(row.unit_price),
    note,
    kind,
    kbtu,
    ports,
    series,
    search: [model, brand, note || "", kind, String(kbtu || ""), series || "", cat].join(" ").toLowerCase(),
  };
}

export default async function CatalogPage() {
  const rows = await fetchAllPriceBookItems<Row>(
    supabase,
    "id, category, name, description, unit_price, tier"
  );

  const byName = new Map<string, CatalogItem>();
  for (const row of rows) {
    const item = enrich(row);
    if (!item) continue;
    const key = item.model.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, item);
      continue;
    }
    if (item.kind === "outdoor_multi" && existing.kind !== "outdoor_multi") {
      byName.set(key, item);
    }
  }

  const items = Array.from(byName.values()).sort((a, b) => a.model.localeCompare(b.model));

  return <CatalogApp items={items} />;
}
