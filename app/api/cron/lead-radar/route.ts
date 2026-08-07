import { NextResponse } from "next/server";
import { runWebSearchSweep } from "@/lib/lead-radar/web-search-sweep";
import { runMissedContactSweep } from "@/lib/lead-radar/missed-contact-sweep";
import { runAgingEquipmentSweep } from "@/lib/lead-radar/aging-equipment-sweep";

type SweepResult = { inserted: number; errors: string[] };

function settle(label: string, result: PromiseSettledResult<SweepResult>): SweepResult {
  if (result.status === "fulfilled") return result.value;
  const message = result.reason instanceof Error ? result.reason.message : "sweep threw";
  return { inserted: 0, errors: [`${label}: ${message}`] };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Run in parallel, not sequentially -- these share one function's time
  // budget, and web search (a live Claude tool call, variable latency) has
  // already caused this route to hit Vercel's 300s cap twice. Sequential
  // awaits meant a slow web search silently starved missed-contact and
  // aging-equipment out of ever running at all on those invocations, with
  // no error logged for either since they never got a turn.
  const [webSearch, missedContact, agingEquipment] = await Promise.allSettled([
    runWebSearchSweep(),
    runMissedContactSweep(),
    runAgingEquipmentSweep(),
  ]);

  const results = {
    webSearch: settle("webSearch", webSearch),
    missedContact: settle("missedContact", missedContact),
    agingEquipment: settle("agingEquipment", agingEquipment),
  };

  console.log("[cron/lead-radar]", JSON.stringify(results));

  return NextResponse.json(results);
}
