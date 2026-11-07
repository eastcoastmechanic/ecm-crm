import { NextResponse } from "next/server";
import { fieldBoardCaller } from "@/lib/bot-keys";
import { isUuid, truckChecklists } from "@/lib/pm/db";
import { truckPmPayload } from "@/lib/pm/truck-hook";

export const dynamic = "force-dynamic";

/**
 * Read hook for the Truck CRM at ecm-field.grok.me.
 *
 * The truck is not called from this route. A later integration can GET this
 * with the same bearer the field board already uses (a bot key, or the old
 * shared FIELD_BOARD_SECRET / FIELD_BOARD_APP_KEY) and render the payload.
 *
 *   GET /api/integrations/truck-crm/pm?job_id=<uuid>
 *   Authorization: Bearer <field board key>
 */
export async function GET(request: Request) {
  if (!(await fieldBoardCaller(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobId = new URL(request.url).searchParams.get("job_id");
  if (jobId && !isUuid(jobId)) {
    return NextResponse.json({ error: "job_id must be a uuid" }, { status: 400 });
  }

  const { rows, error } = await truckChecklists(jobId);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json(truckPmPayload(jobId, rows));
}
