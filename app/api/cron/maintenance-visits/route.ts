import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { supabase } from "@/lib/supabase";
import { etDateKey } from "@/lib/tz";
import { monthName, visitDueNow, visitLabel } from "@/lib/maintenance-visits";

// Daily: for each active plan with a visit schedule, make this month's visit once.
// The visit row (unique per plan and month) is claimed first, then an unscheduled
// maintenance job is created and linked. A visit left without a job is picked up on the next run.
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
    // Already made on an earlier run: leave it, unless that run died before the job was linked.
    let visitId = visit?.id as string | undefined;
    if (!visitId) {
      const { data: existing, error: existingError } = await supabase
        .from("maintenance_visits")
        .select("id, job_id, status")
        .eq("service_contract_id", plan.id)
        .eq("due_year", due.year)
        .eq("due_month", due.month)
        .maybeSingle();
      if (existingError) {
        errors.push(`plan ${plan.id}: ${existingError.message}`);
        continue;
      }
      if (!existing || existing.job_id || existing.status !== "due") continue;
      visitId = existing.id as string;
    }

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
      // The visit stays without a job; tomorrow's run sees that and tries again.
      errors.push(`plan ${plan.id}: ${jobError?.message ?? "job not created"}`);
      continue;
    }

    const { error: linkError } = await supabase.from("maintenance_visits").update({ job_id: job.id }).eq("id", visitId);
    if (linkError) {
      // Remove the job we just made so the retry does not leave a second one behind.
      const { error: undoError } = await supabase.from("jobs").delete().eq("id", job.id);
      errors.push(
        `plan ${plan.id}: visit not linked to job: ${linkError.message}${undoError ? `; job ${job.id} not removed: ${undoError.message}` : ""}`
      );
      continue;
    }
    created++;
  }

  return NextResponse.json({ date: todayKey, plans: plans?.length ?? 0, created, errors });
}
