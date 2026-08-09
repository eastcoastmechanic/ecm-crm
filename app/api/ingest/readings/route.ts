import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { computeSuperheat, computeSubcooling, saturationTempF, REFRIGERANT_TYPES, type RefrigerantType } from "@/lib/refrigerant";

/**
 * Machine ingest for diagnostic readings.
 *
 * One endpoint for every source that produces gauge data — measureQuick,
 * the glasses app, a future probe integration — because they all produce the
 * same shape and all end up in the same place: a diagnostics row.
 *
 * Superheat and subcooling are computed HERE rather than trusted from the
 * caller. Every source has its own idea of saturation temperature, and one
 * disagreeing with ECM's PT tables is how a report ends up contradicting the
 * app that produced it. Raw pressures and temps in, ECM's numbers out.
 *
 * Auth is the shared internal Basic-Auth gate, applied in proxy.ts — this path
 * is registered in INTERNAL_API_PATHS so an unauthenticated call gets a plain
 * 401 rather than an HTML login page, which a machine caller can't use.
 */

type Body = {
  source?: string;
  refrigerant?: string;
  equipmentId?: string;
  serialNumber?: string;
  barcode?: string;
  jobId?: string;
  meteringDevice?: "txv" | "fixed_orifice";
  notes?: string;
  readings?: Record<string, number | null>;
};

const NUMERIC_FIELDS = [
  "outdoor_temp", "indoor_temp", "supply_air_temp", "return_air_temp", "indoor_rh",
  "suction_pressure", "liquid_pressure", "discharge_pressure",
  "suction_line_temp", "liquid_line_temp", "discharge_temp",
  "amp_draw", "voltage", "static_pressure",
] as const;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const refrigerant = body.refrigerant as RefrigerantType | undefined;
  if (refrigerant && !REFRIGERANT_TYPES.includes(refrigerant)) {
    return NextResponse.json(
      { error: `Unknown refrigerant "${refrigerant}". Supported: ${REFRIGERANT_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  const incoming = body.readings ?? {};
  const readings: Record<string, number | null> = {};
  for (const f of NUMERIC_FIELDS) readings[f] = num(incoming[f]);

  if (Object.values(readings).every((v) => v === null)) {
    return NextResponse.json({ error: "No usable readings in payload" }, { status: 400 });
  }

  // Resolve the unit. Barcode and serial are what a tech can actually scan or
  // read off the plate; equipmentId is for callers that already know it.
  let equipmentId: string | null = body.equipmentId ?? null;
  let matchedBy: string | null = equipmentId ? "equipmentId" : null;

  if (!equipmentId && (body.barcode || body.serialNumber)) {
    const column = body.barcode ? "barcode" : "serial_number";
    const value = body.barcode ?? body.serialNumber!;
    const { data } = await supabase.from("equipment").select("id").eq(column, value).limit(2);
    if (data?.length === 1) {
      equipmentId = data[0].id;
      matchedBy = column;
    } else if (data && data.length > 1) {
      return NextResponse.json(
        { error: `More than one piece of equipment has ${column} "${value}" — pass equipmentId.` },
        { status: 409 }
      );
    }
  }

  let superheat: number | null = null;
  let subcooling: number | null = null;
  let suctionSat: number | null = null;
  let liquidSat: number | null = null;

  if (refrigerant) {
    superheat = computeSuperheat(refrigerant, readings.suction_pressure, readings.suction_line_temp);
    subcooling = computeSubcooling(refrigerant, readings.liquid_pressure, readings.liquid_line_temp);
    if (readings.suction_pressure !== null) suctionSat = saturationTempF(refrigerant, readings.suction_pressure);
    if (readings.liquid_pressure !== null) liquidSat = saturationTempF(refrigerant, readings.liquid_pressure);
  }

  const { data, error } = await supabase
    .from("diagnostics")
    .insert({
      equipment_id: equipmentId,
      job_id: body.jobId ?? null,
      readings: {
        ...readings,
        refrigerant: refrigerant ?? null,
        metering_device: body.meteringDevice ?? null,
        superheat,
        subcooling,
        saturated_suction_temp: suctionSat,
        saturated_liquid_temp: liquidSat,
        // Kept so a report can say where its numbers came from — a probe
        // reading and an OCR'd gauge photo don't warrant equal confidence.
        source: body.source ?? "api",
        ingested_at: new Date().toISOString(),
      },
      suggested_fix: body.notes ?? null,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    diagnosticId: data.id,
    equipmentId,
    matchedBy,
    computed: { superheat, subcooling, saturatedSuctionTemp: suctionSat, saturatedLiquidTemp: liquidSat },
  });
}
