import { NextResponse } from "next/server";
import { runWebSearchSweep } from "@/lib/lead-radar/web-search-sweep";
import { runMissedContactSweep } from "@/lib/lead-radar/missed-contact-sweep";
import { runAgingEquipmentSweep } from "@/lib/lead-radar/aging-equipment-sweep";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, { inserted: number; errors: string[] }> = {};

  try {
    results.webSearch = await runWebSearchSweep();
  } catch (err) {
    results.webSearch = { inserted: 0, errors: [err instanceof Error ? err.message : "sweep threw"] };
  }

  try {
    results.missedContact = await runMissedContactSweep();
  } catch (err) {
    results.missedContact = { inserted: 0, errors: [err instanceof Error ? err.message : "sweep threw"] };
  }

  try {
    results.agingEquipment = await runAgingEquipmentSweep();
  } catch (err) {
    results.agingEquipment = { inserted: 0, errors: [err instanceof Error ? err.message : "sweep threw"] };
  }

  return NextResponse.json(results);
}
