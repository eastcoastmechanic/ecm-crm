"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { sendSMS } from "@/lib/sms";
import {
  appendJobPhotos,
  uploadJobPhotoFiles,
  JOB_PHOTO_PHASES,
  type JobPhotoPhase,
} from "@/lib/job-photos";
import { syncJobToGraph } from "@/lib/graph-connector";
import { syncJobToPlanner } from "@/lib/planner-connector";
import { applyJobStatus, sendScheduleNotifications } from "@/lib/job-lifecycle";
import { requireOffice, requireRole } from "@/lib/require-role";
import { notifyTech } from "@/lib/tech-notice-send";
import { getMyStaffId, requireJobAccess } from "@/lib/job-access";
import { parseEtLocal } from "@/lib/tz";

export async function createServiceCall() {
  const role = await requireRole(["owner", "office", "tech"]);
  // A tech who starts a service call owns it, so the ownership checks let them finish it.
  const assigned_staff_id = role === "tech" ? await getMyStaffId() : null;
  if (role === "tech" && !assigned_staff_id) throw new Error("Not allowed");

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      ...(assigned_staff_id ? { assigned_staff_id } : {}),
      customer_id: null,
      property_id: null,
      status: "in_progress",
      job_type: "service",
      scheduled_at: new Date().toISOString(),
      created_via: "manual",
    })
    .select("id")
    .single();

  if (error || !job) throw new Error(error?.message ?? "Failed to start service call");

  await syncJobToPlanner(job.id, "in_progress");

  revalidatePath("/jobs");
  redirect(`/diagnostics/new?job_id=${job.id}`);
}

/** Create the install job for a signed contract. One job per contract; a repeat just opens the existing one. */
export async function scheduleJobFromContract(formData: FormData) {
  await requireOffice();
  const documentId = formData.get("document_id") as string;
  const when = parseEtLocal(formData.get("scheduled_at") as string);
  if (!when) throw new Error("Pick a date and time for the job");

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, type, status, customer_id, property_id, line_items")
    .eq("id", documentId)
    .single();
  if (docError || !doc) throw new Error("Contract not found");
  if (doc.type !== "contract" || doc.status !== "signed") throw new Error("Only a signed contract can be scheduled");

  const { data: existing } = await supabase.from("jobs").select("id").eq("document_id", documentId).limit(1);
  if (existing && existing.length > 0) redirect("/jobs");

  const scope = ((doc.line_items as { scopeOfWork?: string } | null)?.scopeOfWork ?? "").trim();
  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      customer_id: doc.customer_id,
      property_id: doc.property_id,
      document_id: doc.id,
      job_type: "install",
      status: "scheduled",
      scheduled_at: when.toISOString(),
      notes: scope ? scope.slice(0, 500) : null,
      created_via: "manual",
    })
    .select("id")
    .single();
  if (error || !job) throw new Error(error?.message ?? "Failed to schedule job");

  await syncJobToPlanner(job.id, "scheduled");
  await syncJobToGraph(job.id);

  revalidatePath("/jobs");
  revalidatePath(`/documents/${documentId}`);
  redirect("/jobs");
}

/** Tell whoever the job is assigned to (if anyone) that it moved. Best effort. */
async function notifyAssignedTech(jobId: string, kind: "rescheduled" | "cancelled") {
  const { data } = await supabase.from("jobs").select("assigned_staff_id").eq("id", jobId).maybeSingle();
  await notifyTech({
    jobId,
    staffId: (data?.assigned_staff_id as string | null | undefined) ?? null,
    kind,
    actorStaffId: await getMyStaffId(),
  });
}

/** Assign a job to a staff member, or clear it (empty staff_id). */
export async function assignJob(formData: FormData) {
  await requireOffice();
  const jobId = formData.get("job_id") as string;
  const staffId = ((formData.get("staff_id") as string) || "").trim() || null;
  if (!jobId) throw new Error("Job is required");

  const { data: before } = await supabase.from("jobs").select("assigned_staff_id").eq("id", jobId).maybeSingle();
  const previousStaffId = (before?.assigned_staff_id as string | null | undefined) ?? null;

  const { error } = await supabase.from("jobs").update({ assigned_staff_id: staffId }).eq("id", jobId);
  if (error) throw new Error(error.message);

  // Tell the tech who got the job, and the one who lost it. Best effort, never blocks.
  if (staffId !== previousStaffId) {
    const actorStaffId = await getMyStaffId();
    await notifyTech({ jobId, staffId, kind: "assigned", actorStaffId });
    await notifyTech({ jobId, staffId: previousStaffId, kind: "unassigned", actorStaffId });
  }

  revalidatePath("/jobs");
  revalidatePath("/field-board");
}

type CustomerContact = {
  name: string | null;
  email: string | null;
  phone: string | null;
  sms_consent: boolean | null;
} | null;
type PropertyInfo = { address: string | null } | null;

export async function updateJobStatus(formData: FormData) {
  const id = formData.get("id") as string;
  const status = formData.get("status") as string;

  // Office and owner can set any status. A tech can only start or finish their own open job.
  await requireJobAccess(id, { nextStatus: status });

  await applyJobStatus(id, status);

  revalidatePath("/jobs");
}

/** Change a job's date and time (New York wall-clock, "2026-10-22T09:30"). Notifies the customer and syncs Graph. */
export async function rescheduleJobAt(jobId: string, localDateTime: string) {
  await requireOffice();
  const next = parseEtLocal(localDateTime);
  if (!next) throw new Error("Pick a valid date and time");

  const { error } = await supabase.from("jobs").update({ scheduled_at: next.toISOString() }).eq("id", jobId);
  if (error) throw new Error(error.message);

  await sendScheduleNotifications(jobId);
  await syncJobToGraph(jobId);
  await notifyAssignedTech(jobId, "rescheduled");

  revalidatePath("/jobs");
  revalidatePath("/dispatch");
}

export async function rescheduleJob(jobId: string, newDate: string) {
  await requireOffice();
  const { data: existing, error: fetchError } = await supabase
    .from("jobs")
    .select("scheduled_at")
    .eq("id", jobId)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const [year, month, day] = newDate.split("-").map(Number);
  const next = existing.scheduled_at ? new Date(existing.scheduled_at) : new Date(year, month - 1, day, 9, 0, 0);
  next.setFullYear(year, month - 1, day);

  const { error } = await supabase
    .from("jobs")
    .update({ scheduled_at: next.toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(error.message);

  await sendScheduleNotifications(jobId);
  await syncJobToGraph(jobId);
  await notifyAssignedTech(jobId, "rescheduled");

  revalidatePath("/jobs");
}

export async function addJobPhotos(formData: FormData) {
  const jobId = formData.get("job_id") as string;
  await requireJobAccess(jobId, { allowClosedJob: true });
  const caption = (formData.get("caption") as string)?.trim() || null;
  const files = formData.getAll("photos") as File[];

  const rawPhase = formData.get("phase") as string | null;
  const phase = JOB_PHOTO_PHASES.includes(rawPhase as JobPhotoPhase)
    ? (rawPhase as JobPhotoPhase)
    : undefined;

  // Uploads go to the private job-photos bucket; the page mints signed URLs to
  // display them. See lib/job-photos.ts.
  const newPhotos = await uploadJobPhotoFiles(files, { phase, caption });
  if (newPhotos.length === 0) return;

  await appendJobPhotos(jobId, newPhotos);

  revalidatePath("/jobs");
}

export async function markOnWay(jobId: string) {
  await requireJobAccess(jobId);
  const { data: job } = await supabase
    .from("jobs")
    .select("customers(name, email, phone, sms_consent), properties(address)")
    .eq("id", jobId)
    .single();

  const { error } = await supabase
    .from("jobs")
    .update({ on_way_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(error.message);

  const customer = job?.customers as unknown as CustomerContact;
  const property = job?.properties as unknown as PropertyInfo;
  const message = `Hi ${customer?.name ?? ""}, your East Coast Mechanical technician is on the way${
    property?.address ? ` to ${property.address}` : ""
  }!`;

  if (customer?.email) {
    await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
      to: customer.email,
      subject: "Your technician is on the way",
      text: message,
    });
  }

  if (customer?.phone && customer?.sms_consent) {
    const sent = await sendSMS(customer.phone, message);
    if (!sent.ok) console.error(`On-the-way text failed: ${sent.error}`);
  }

  revalidatePath("/jobs");
}
