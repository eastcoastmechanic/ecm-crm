import type { SupabaseClient } from "@supabase/supabase-js";

type PriceBookRow = {
  category: string | null;
  name: string;
  tier: string | null;
  unit_price: number | null;
};

const PAGE_SIZE = 1000;

/**
 * Supabase/PostgREST caps unbounded selects at 1000 rows by default — with
 * 1,800+ price book rows, a plain `.select("*")` silently drops everything
 * past row 1000 (an entire brand's catalog, alphabetically) with no error.
 * Pages through the full table so every caller (the AI prompt builder, the
 * price-book UI, diagnostics) sees every row.
 */
export async function fetchAllPriceBookItems<T = PriceBookRow>(
  supabase: SupabaseClient,
  columns = "*"
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("price_book_items")
      .select(columns)
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

/**
 * Condenses price_book_items rows into a compact "Name: G=x B=y X=z" text
 * block grouped by category, so the full book fits cheaply into a prompt.
 */
export function formatPriceBookForPrompt(rows: PriceBookRow[]): string {
  const groups = new Map<
    string,
    { category: string; name: string; good?: number; better?: number; best?: number; flat?: number }
  >();

  for (const row of rows) {
    const category = row.category ?? "Uncategorized";
    const key = `${category}::${row.name}`;
    if (!groups.has(key)) {
      groups.set(key, { category, name: row.name });
    }
    const group = groups.get(key)!;
    if (row.unit_price === null) continue;
    if (row.tier === "good") group.good = row.unit_price;
    else if (row.tier === "better") group.better = row.unit_price;
    else if (row.tier === "best") group.best = row.unit_price;
    // Untiered rows (e.g. distributor-cost-derived equipment SKUs with a
    // single sell price, no good/better/best split) get a flat price
    // instead of being silently dropped from the prompt.
    else group.flat = row.unit_price;
  }

  const byCategory = new Map<string, string[]>();
  for (const group of groups.values()) {
    const parts: string[] = [];
    if (group.good !== undefined) parts.push(`G=${group.good}`);
    if (group.better !== undefined) parts.push(`B=${group.better}`);
    if (group.best !== undefined) parts.push(`X=${group.best}`);
    if (group.flat !== undefined) parts.push(`$${group.flat}`);
    const line = `${group.name}: ${parts.join(" ")}`;
    if (!byCategory.has(group.category)) byCategory.set(group.category, []);
    byCategory.get(group.category)!.push(line);
  }

  const sections: string[] = [];
  for (const [category, lines] of byCategory) {
    sections.push(`${category.toUpperCase()}:\n${lines.join("\n")}`);
  }
  return sections.join("\n\n");
}
