import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { supabase } from "@/lib/supabase";
import { etDateKey } from "@/lib/tz";
import { monthName, visitDueNow, visitLabel } from "@/lib/maintenance-visits";

// Daily: for each active plan with a visit schedule, make this month's visit once.
// The visit row (unique per plan and month) is claimed first, then an unscheduled
// maintenance job is created for it, so a repeat run or a retry cannot double up.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const todayKey = etDateKey();
  const { data: plans, error } = await supabase
    .from("service_contracts")
    .select("id, customer_id, property_id, start_date, end_date, visit_months")
    .eq("status", "active")
    .not("visit_months", "is", null);
  if (error) return NextResponse.json({ created: 0, errors: [error.message] });

  let created = 0;
  const errors: string[] = [];

  for (const plan of plans ?? []) {
    const due = visitDueNow({
      visitMonths: plan.visit_months as number[] | null,
      startDate: plan.start_date as string | null,
      endDate: plan.end_date as string | null,
      todayKey,
    });
    if (!due) continue;

    const label = visitLabel(due.month);
    const { data: visit, error: visitError } = await supabase
      .from("maintenance_visits")
      .upsert(
        {
          service_contract_id: plan.id,
          customer_id: plan.customer_id,
          property_id: plan.property_id,
          due_year: due.year,
          due_month: due.month,
          label,
        },
        { onConflict: "service_contract_id,due_year,due_month", ignoreDuplicates: true }
      )
      .select("id")
      .maybeSingle();
    if (visitError) {
      errors.push(`plan ${plan.id}: ${visitError.message}`);
      continue;
    }
    if (!visit) continue; // already made on an earlier run

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        customer_id: plan.customer_id,
        property_id: plan.property_id,
        job_type: "maintenance",
        status: "requested",
        scheduled_at: null,
        notes: `Maintenance plan visit: ${label} (${monthName(due.month)} ${due.year}).`,
        created_via: "maintenance_plan",
      })
      .select("id")
      .single();
    if (jobError || !job) {
      // Release the claim so tomorrow's run tries again.
      await supabase.from("maintenance_visits").delete().eq("id", visit.id);
      errors.push(`plan ${plan.id}: ${jobError?.message ?? "job not created"}`);
      continue;
    }

    const { error: linkError } = await supabase.from("maintenance_visits").update({ job_id: job.id }).eq("id", visit.id);
    if (linkError) {
      // An unlinked visit would be skipped forever and never complete. Undo both so tomorrow's run starts clean.
      await supabase.from("jobs").delete().eq("id", job.id);
      await supabase.from("maintenance_visits").delete().eq("id", visit.id);
      errors.push(`plan ${plan.id}: visit not linked to job, undone: ${linkError.message}`);
      continue;
    }
    created++;
  }

  return NextResponse.json({ date: todayKey, plans: plans?.length ?? 0, created, errors });
}
