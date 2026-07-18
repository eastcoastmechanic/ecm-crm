type PriceBookRow = {
  category: string | null;
  name: string;
  tier: string | null;
  unit_price: number | null;
};

/**
 * Condenses price_book_items rows into a compact "Name: G=x B=y X=z" text
 * block grouped by category, so the full book fits cheaply into a prompt.
 */
export function formatPriceBookForPrompt(rows: PriceBookRow[]): string {
  const groups = new Map<
    string,
    { category: string; name: string; good?: number; better?: number; best?: number }
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
  }

  const byCategory = new Map<string, string[]>();
  for (const group of groups.values()) {
    const parts: string[] = [];
    if (group.good !== undefined) parts.push(`G=${group.good}`);
    if (group.better !== undefined) parts.push(`B=${group.better}`);
    if (group.best !== undefined) parts.push(`X=${group.best}`);
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
