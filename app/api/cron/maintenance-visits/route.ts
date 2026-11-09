import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { supabase } from "@/lib/supabase";
import { etDateKey } from "@/lib/tz";
import { noteJobStep } from "@/lib/planner-connector";
import { monthName, visitDueNow, visitLabel } from "@/lib/maintenance-visits";

type VisitJobInput = {
  visitId: string;
  customerId: string | null;
  propertyId: string | null;
  label: string;
  year: number;
  month: number;
};

// Make the unscheduled maintenance job for a visit and link it. Returns an error text, or null on success.
// Safe to repeat: if an earlier run made the job but could not link it, that job is reused, not duplicated.
async function createJobForVisit(v: VisitJobInput): Promise<string | null> {
  // The short visit id keeps two plans for the same customer and property from sharing one job.
  const notes = `Maintenance plan visit: ${v.label} (${monthName(v.month)} ${v.year}). Ref ${v.visitId.slice(0, 8)}`;

  let existingQuery = supabase
    .from("jobs")
    .select("id")
    .eq("created_via", "maintenance_plan")
    .eq("notes", notes)
    .neq("status", "cancelled")
    .limit(1);
  existingQuery = v.customerId ? existingQuery.eq("customer_id", v.customerId) : existingQuery.is("customer_id", null);
  existingQuery = v.propertyId ? existingQuery.eq("property_id", v.propertyId) : existingQuery.is("property_id", null);
  const { data: found, error: findError } = await existingQuery;
  if (findError) return findError.message;

  let jobId = found?.[0]?.id as string | undefined;
  if (!jobId) {
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        customer_id: v.customerId,
        property_id: v.propertyId,
        job_type: "maintenance",
        status: "requested",
        scheduled_at: null,
        notes,
        created_via: "maintenance_plan",
      })
      .select("id")
      .single();
    // The visit stays without a job; the sweep finds it on the next run.
    if (jobError || !job) return jobError?.message ?? "job not created";
    jobId = job.id as string;
    // The visit's card on the Jobs plan ("Requested from maintenance plan"). Never throws.
    await noteJobStep(jobId, "requested");
  }

  const { error: linkError } = await supabase.from("maintenance_visits").update({ job_id: jobId }).eq("id", v.visitId);
  if (linkError) return `visit not linked to job ${jobId}, will retry: ${linkError.message}`;
  return null;
}

// Daily: for each active plan with a visit schedule, make this month's visit once.
// The visit row (unique per plan and month) is claimed first, then an unscheduled
// maintenance job is created and linked. A visit left without a job (any month) is picked up by the sweep on the next run.
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

  // Sweep first: any open visit, from any month, that never got its job (an earlier run died part way).
  const { data: orphans, error: orphanError } = await supabase
    .from("maintenance_visits")
    .select("id, customer_id, property_id, label, due_year, due_month")
    .eq("status", "due")
    .is("job_id", null);
  if (orphanError) errors.push(`sweep: ${orphanError.message}`);
  for (const o of orphans ?? []) {
    const problem = await createJobForVisit({
      visitId: o.id as string,
      customerId: o.customer_id as string | null,
      propertyId: o.property_id as string | null,
      label: (o.label as string | null) ?? visitLabel(o.due_month as number),
      year: o.due_year as number,
      month: o.due_month as number,
    });
    if (problem) errors.push(`visit ${o.id}: ${problem}`);
    else created++;
  }

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
    // Already made on an earlier run: leave it. A visit that lost its job is handled by the sweep above.
    if (!visit) continue;

    const problem = await createJobForVisit({
      visitId: visit.id as string,
      customerId: plan.customer_id as string | null,
      propertyId: plan.property_id as string | null,
      label,
      year: due.year,
      month: due.month,
    });
    if (problem) {
      errors.push(`plan ${plan.id}: ${problem}`);
      continue;
    }
    created++;
  }

  return NextResponse.json({ date: todayKey, plans: plans?.length ?? 0, created, errors });
}
