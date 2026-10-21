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
import { requireOffice } from "@/lib/require-role";

export async function createServiceCall() {
  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
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

  await applyJobStatus(id, status);

  revalidatePath("/jobs");
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

  revalidatePath("/jobs");
}

export async function addJobPhotos(formData: FormData) {
  const jobId = formData.get("job_id") as string;
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
    await sendSMS(customer.phone, message);
  }

  revalidatePath("/jobs");
}
