import { readFile } from "fs/promises";
import path from "path";
import CatalogApp from "./CatalogApp";

export const dynamic = "force-static";

type CatalogItem = {
  id: string;
  model: string;
  brand: string;
  cost: number | null;
  sell: number;
  note: string | null;
  kind: string;
  kbtu: number | null;
  ports: number | null;
  series: string | null;
  sheet: string;
  search: string;
};

export default async function CatalogPage() {
  const file = path.join(process.cwd(), "public", "catalog.json");
  const raw = await readFile(file, "utf8");
  const items = JSON.parse(raw) as CatalogItem[];

  return <CatalogApp items={items} />;
}
