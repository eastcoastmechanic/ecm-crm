import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireOffice } from "@/lib/require-role";
import { one } from "@/lib/appointment-reminder";
import { etDayRange, toEtLocalInput } from "@/lib/tz";
import { routeSlotTimes } from "@/lib/route-slots";
import { rescheduleJobAt } from "@/app/(internal)/jobs/actions";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const SHOP_ADDRESS = process.env.SHOP_ADDRESS;

export async function POST(request: Request) {
  try {
    await requireOffice();
  } catch {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

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
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Missing date" }, { status: 400 });

  // The route day is the New York calendar day, not the server's (UTC) day.
  const day = etDayRange(date);

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, scheduled_at, properties(address)")
    .gte("scheduled_at", day.start.toISOString())
    .lt("scheduled_at", day.end.toISOString())
    .in("status", ["requested", "scheduled", "in_progress"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const stops = (jobs ?? [])
    .map((j) => ({
      id: j.id as string,
      scheduledAt: j.scheduled_at as string,
      address: one(j.properties as { address: string | null } | { address: string | null }[] | null)?.address,
    }))
    .filter((s): s is { id: string; scheduledAt: string; address: string } => !!s.address);

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
  const slots = routeSlotTimes(date, orderedStops.length);

  // Each move goes through the normal job action, so the customer's schedule
  // notice, the calendar sync and the tech alert fire like any other reschedule.
  // A stop already at its slot is left alone.
  const errors: string[] = [];
  let moved = 0;
  for (let i = 0; i < orderedStops.length; i++) {
    const stop = orderedStops[i];
    if (toEtLocalInput(stop.scheduledAt) === slots[i]) continue;
    const result = await rescheduleJobAt(stop.id, slots[i]);
    if (result.error) errors.push(`${stop.address}: ${result.error}`);
    else moved++;
  }

  if (errors.length) {
    return NextResponse.json({ error: `Moved ${moved}, failed ${errors.length}: ${errors.join("; ")}` }, { status: 500 });
  }
  return NextResponse.json({ optimized: true, moved, order: orderedStops.map((s) => s.id) });
}
