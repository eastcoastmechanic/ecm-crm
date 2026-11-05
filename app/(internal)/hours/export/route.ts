import { getStaffRole } from "@/lib/require-role";
import { supabase } from "@/lib/supabase";
import { etDateKey, addDaysToDateKey, parseEtLocal } from "@/lib/tz";
import { buildWeekReport, weekCsv, type EntryRow, type ShiftRow, type StaffRow } from "@/lib/time-report";

export const dynamic = "force-dynamic";

// Monday of the week containing a YYYY-MM-DD date.
function mondayOf(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysToDateKey(ymd, -((dow + 6) % 7));
}

/** Weekly hours file for payroll. Owner and office only. GET /hours/export?week=YYYY-MM-DD */
export async function GET(request: Request) {
  const role = await getStaffRole();
  if (role !== "owner" && role !== "office") return new Response("Forbidden", { status: 403 });

  const week = new URL(request.url).searchParams.get("week");
  const start = mondayOf(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : etDateKey());
  const from = parseEtLocal(`${start}T00:00`);
  const to = parseEtLocal(`${addDaysToDateKey(start, 7)}T00:00`);
  if (!from || !to) return new Response("Bad week", { status: 400 });

  const [{ data: staff }, { data: shifts }, { data: entries }] = await Promise.all([
    supabase.from("staff").select("id, name, email"),
    supabase
      .from("time_shifts")
      .select("id, staff_id, started_at, ended_at, break_minutes, flagged, reviewed_at")
      .gte("started_at", from.toISOString())
      .lt("started_at", to.toISOString()),
    supabase
      .from("job_time_entries")
      .select("id, job_id, staff_id, kind, started_at, ended_at, flagged, reviewed_at")
      .gte("started_at", from.toISOString())
      .lt("started_at", to.toISOString()),
  ]);

  const csv = weekCsv(
    start,
    buildWeekReport((staff ?? []) as StaffRow[], (shifts ?? []) as ShiftRow[], (entries ?? []) as EntryRow[])
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ecm-hours-${start}.csv"`,
    },
  });
}
