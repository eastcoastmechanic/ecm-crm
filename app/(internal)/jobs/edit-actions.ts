"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { requireOffice } from "@/lib/require-role";
import { applyJobStatus } from "@/lib/job-lifecycle";
import { syncJobToGraph } from "@/lib/graph-connector";
import { getMyStaffId } from "@/lib/job-access";
import { getFinishBlockers } from "@/lib/job-checklist";
import { getInvoicePrompt } from "@/lib/finish-invoice";
import { fetchAllRows } from "@/lib/fetch-all";
import type { InvoicePrompt } from "@/lib/job-invoice-rules";
import {
  officeDoneGate,
  parseJobEdit,
  statusBeforeTime,
  isDoneStatus,
  type JobEditChanges,
} from "@/lib/job-edit-rules";
import { assignJobToStaff, rescheduleJobAt } from "./actions";

/** What the editor typed, echoed back so the form keeps it after an error (React 19 clears forms). */
export type JobEditValues = {
  customerId?: string;
  propertyId?: string;
  newAddress?: string;
  jobType?: string;
  notes?: string;
  staffId?: string;
  scheduledAt?: string;
  status?: string;
  doneReason?: string;
};

export type JobEditState = {
  error?: string;
  /** The job is not finished on the truck: the form shows the "mark done anyway" reason box. */
  needsReason?: boolean;
  values?: JobEditValues;
  saved?: boolean;
  /** Owner/office just marked it done: the draft invoice to send. */
  invoicePrompt?: InvoicePrompt;
} | null;

export type JobEditOptions = {
  error?: string;
  customers: { id: string; name: string }[];
  properties: { id: string; address: string; customer_id: string | null }[];
};

/** Customers and addresses for the editor's pickers. Loaded when the editor opens, not on every /jobs load. */
export async function loadJobEditOptions(): Promise<JobEditOptions> {
  try {
    await requireOffice();
  } catch {
    return { error: "Only the office can edit jobs.", customers: [], properties: [] };
  }
  const [customers, properties] = await Promise.all([
    fetchAllRows<{ id: string; name: string | null }>((from, to) =>
      supabase.from("customers").select("id, name").order("name").order("id").range(from, to)
    ),
    fetchAllRows<{ id: string; address: string | null; customer_id: string | null }>((from, to) =>
      supabase.from("properties").select("id, address, customer_id").order("address").order("id").range(from, to)
    ),
  ]);
  if (customers.error || properties.error) {
    return { error: "Couldn't load customers and addresses. Close and open the editor again.", customers: [], properties: [] };
  }
  return {
    customers: customers.data.map((c) => ({ id: c.id, name: c.name || "Unnamed customer" })),
    properties: properties.data.map((p) => ({ id: p.id, address: p.address || "(no address)", customer_id: p.customer_id })),
  };
}

function field(formData: FormData, name: string): string | null {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
}

/**
 * Owner/office edit any part of a job from /jobs. Only the fields the person changed are saved.
 * Plain fields (customer, address, type, notes) are written here; the tech goes through
 * assignJobToStaff, the time through rescheduleJobAt and the status through applyJobStatus, so
 * tech notices, customer schedule notices, Planner/Graph sync, timers, the Finish draft
 * invoice and owner alerts all fire as they do everywhere else.
 */
export async function saveJobEdit(_prev: JobEditState, formData: FormData): Promise<JobEditState> {
  const values: JobEditValues = {
    customerId: field(formData, "customer_id") ?? undefined,
    propertyId: field(formData, "property_id") ?? undefined,
    newAddress: field(formData, "new_address") ?? undefined,
    jobType: field(formData, "job_type") ?? undefined,
    notes: field(formData, "notes") ?? undefined,
    staffId: field(formData, "staff_id") ?? undefined,
    scheduledAt: field(formData, "scheduled_at") ?? undefined,
    status: field(formData, "status") ?? undefined,
    doneReason: field(formData, "done_reason") ?? undefined,
  };
  const fail = (error: string, extra: Partial<NonNullable<JobEditState>> = {}): JobEditState => ({ error, values, ...extra });

  let role: Awaited<ReturnType<typeof requireOffice>>;
  try {
    role = await requireOffice();
  } catch {
    return fail("Only the office can edit jobs.");
  }

  const jobId = (field(formData, "job_id") ?? "").trim();
  if (!jobId) return fail("Job is required.");

  const parsed = parseJobEdit({
    customerId: field(formData, "customer_id"),
    originalCustomerId: field(formData, "original_customer_id"),
    propertyId: field(formData, "property_id"),
    originalPropertyId: field(formData, "original_property_id"),
    newAddress: field(formData, "new_address"),
    jobType: field(formData, "job_type"),
    originalJobType: field(formData, "original_job_type"),
    notes: field(formData, "notes"),
    originalNotes: field(formData, "original_notes"),
    staffId: field(formData, "staff_id"),
    originalStaffId: field(formData, "original_staff_id"),
    scheduledAt: field(formData, "scheduled_at"),
    originalScheduledAt: field(formData, "original_scheduled_at"),
    status: field(formData, "status"),
    originalStatus: field(formData, "original_status"),
  });
  if ("error" in parsed) return fail(parsed.error);
  const changes: JobEditChanges = parsed.changes;
  if (Object.keys(changes).length === 0) return { saved: true };

  const { data: job, error: readError } = await supabase
    .from("jobs")
    .select("id, status, customer_id")
    .eq("id", jobId)
    .maybeSingle();
  if (readError) return fail("Couldn't load the job. Try again.");
  if (!job) return fail("Job not found.");

  // Check everything before saving anything, so a bad pick never leaves the job half changed.
  const customerAfter = changes.customerId !== undefined ? changes.customerId : ((job.customer_id as string | null) ?? "");
  if (changes.customerId) {
    const { data: customer } = await supabase.from("customers").select("id").eq("id", changes.customerId).maybeSingle();
    if (!customer) return fail("That customer no longer exists. Refresh and pick again.");
  }
  if (changes.propertyId) {
    const { data: property } = await supabase
      .from("properties")
      .select("id, customer_id")
      .eq("id", changes.propertyId)
      .maybeSingle();
    if (!property) return fail("That address no longer exists. Refresh and pick again.");
    if (!customerAfter || property.customer_id !== customerAfter) return fail("That address belongs to a different customer.");
  }

  let doneLog: string | null = null;
  if (changes.status === "complete" && !isDoneStatus(job.status as string | null)) {
    const gate = officeDoneGate(await getFinishBlockers(jobId), values.doneReason);
    if (!gate.ok) return fail(gate.error, { needsReason: true });
    doneLog = gate.logReason;
  }

  let savedSomething = false;
  const partly = (error: string) => fail(savedSomething ? `Some changes were saved, but: ${error}` : error);

  // Plain fields: no lifecycle behind them.
  const plain: Record<string, string | null> = {};
  if (changes.newAddress) {
    const { data: created, error: addError } = await supabase
      .from("properties")
      .insert({ customer_id: customerAfter, address: changes.newAddress })
      .select("id")
      .single();
    if (addError || !created) return fail("Couldn't add the new address. Try again.");
    plain.property_id = created.id as string;
  }
  if (changes.customerId !== undefined) plain.customer_id = changes.customerId || null;
  if (changes.propertyId !== undefined) plain.property_id = changes.propertyId || null;
  if (changes.jobType !== undefined) plain.job_type = changes.jobType;
  if (changes.notes !== undefined) plain.notes = changes.notes || null;
  if (Object.keys(plain).length > 0) {
    const { error } = await supabase.from("jobs").update(plain).eq("id", jobId);
    if (error) return fail("Couldn't save the job. Try again.");
    savedSomething = true;
  }

  if (changes.staffId !== undefined) {
    const assigned = await assignJobToStaff(jobId, changes.staffId || null);
    if (assigned.error) return partly(assigned.error);
    savedSomething = true;
  }

  const applyStatus = async (): Promise<string | null> => {
    if (!changes.status) return null;
    if (doneLog) {
      // Logged like the owner unlock on the truck card: who, which role, why.
      const { error } = await supabase.from("job_checklist_unlocks").insert({
        job_id: jobId,
        unlocked_by: await getMyStaffId(),
        unlocked_by_role: role,
        reason: doneLog,
      });
      if (error) return "Couldn't record why it was marked done, so it wasn't. Try again.";
    }
    try {
      await applyJobStatus(jobId, changes.status);
    } catch {
      return "Couldn't save the status. Try again.";
    }
    savedSomething = true;
    return null;
  };
  const applyTime = async (): Promise<string | null> => {
    if (!changes.scheduledAt) return null;
    const moved = await rescheduleJobAt(jobId, changes.scheduledAt);
    if (moved.error) return moved.error;
    savedSomething = true;
    return null;
  };

  // Closing first means a time fix on a finished or cancelled job sends no "you're scheduled" notice.
  const steps = statusBeforeTime(changes.status) ? [applyStatus, applyTime] : [applyTime, applyStatus];
  for (const step of steps) {
    const error = await step();
    if (error) return partly(error);
  }

  // Customer, address or notes changed with no status change: refresh the SharePoint job item.
  if (Object.keys(plain).length > 0 && !changes.status) await syncJobToGraph(jobId);

  revalidatePath("/jobs");
  revalidatePath("/dispatch");
  revalidatePath("/field-board");

  if (changes.status === "complete") {
    const invoicePrompt = await getInvoicePrompt(jobId);
    if (invoicePrompt) return { saved: true, invoicePrompt };
  }
  return { saved: true };
}
