import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const SHOP_ADDRESS = process.env.SHOP_ADDRESS;

// Slot spacing between stops on the optimized route — a simple fixed
// estimate since real per-job duration isn't tracked ahead of time.
const SLOT_HOURS = 1.5;
const DAY_START_HOUR = 8;

export async function POST(request: Request) {
  if (!GOOGLE_MAPS_API_KEY || !SHOP_ADDRESS) {
    return NextResponse.json(
      {
        error:
          "Route optimization needs GOOGLE_MAPS_API_KEY and SHOP_ADDRESS set in the environment.",
      },
      { status: 400 }
    );
  }

  const { date } = (await request.json().catch(() => ({}))) as { date?: string };
  if (!date) return NextResponse.json({ error: "Missing date" }, { status: 400 });

  const [year, month, day] = date.split("-").map(Number);
  const dayStart = new Date(year, month - 1, day, 0, 0, 0);
  const dayEnd = new Date(year, month - 1, day, 23, 59, 59);

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, scheduled_at, properties(address)")
    .gte("scheduled_at", dayStart.toISOString())
    .lte("scheduled_at", dayEnd.toISOString())
    .in("status", ["requested", "scheduled", "in_progress"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const stops = (jobs ?? [])
    .map((j) => ({
      id: j.id,
      address: (j.properties as unknown as { address: string | null }[] | null)?.[0]?.address,
    }))
    .filter((s): s is { id: string; address: string } => !!s.address);

  if (stops.length < 2) {
    return NextResponse.json({ optimized: false, reason: "Fewer than 2 addressed stops that day." });
  }

  const routesResponse = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask": "routes.optimizedIntermediateWaypointIndex",
    },
    body: JSON.stringify({
      origin: { address: SHOP_ADDRESS },
      destination: { address: SHOP_ADDRESS },
      intermediates: stops.map((s) => ({ address: s.address })),
      optimizeWaypointOrder: true,
      travelMode: "DRIVE",
    }),
  });

  if (!routesResponse.ok) {
    const text = await routesResponse.text();
    return NextResponse.json({ error: `Google Routes API error: ${text}` }, { status: 502 });
  }

  const routesData = await routesResponse.json();
  const order: number[] | undefined = routesData.routes?.[0]?.optimizedIntermediateWaypointIndex;

  if (!order) {
    return NextResponse.json({ error: "Routes API returned no optimized order." }, { status: 502 });
  }

  const orderedStops = order.map((i) => stops[i]);

  for (let i = 0; i < orderedStops.length; i++) {
    const slotTime = new Date(dayStart);
    slotTime.setHours(DAY_START_HOUR, 0, 0, 0);
    slotTime.setMinutes(slotTime.getMinutes() + i * SLOT_HOURS * 60);

    await supabase.from("jobs").update({ scheduled_at: slotTime.toISOString() }).eq("id", orderedStops[i].id);
  }

  return NextResponse.json({ optimized: true, order: orderedStops.map((s) => s.id) });
}
