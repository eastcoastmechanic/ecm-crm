"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL } from "@/lib/resend";
import { sendSMS } from "@/lib/sms";
import { generateJobICS } from "@/lib/ics";
import {
  appendJobPhotos,
  uploadJobPhotoFiles,
  JOB_PHOTO_PHASES,
  type JobPhotoPhase,
} from "@/lib/job-photos";
import { syncJobToGraph } from "@/lib/graph-connector";
import { syncJobToPlanner } from "@/lib/planner-connector";

const OWNER_EMAIL = process.env.OWNER_EMAIL;

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

async function sendScheduleNotifications(jobId: string) {
  const { data: job } = await supabase
    .from("jobs")
    .select("id, scheduled_at, ics_sequence, customers(name, email, phone, sms_consent), properties(address)")
    .eq("id", jobId)
    .single();

  if (!job || !job.scheduled_at) return;

  const customer = job.customers as unknown as CustomerContact;
  const property = job.properties as unknown as PropertyInfo;

  const start = new Date(job.scheduled_at);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const when = start.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const whereText = property?.address ? ` at ${property.address}` : "";

  if (customer?.email) {
    await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      to: customer.email,
      subject: `You're scheduled for ${when}`,
      text: `Hi ${customer.name ?? ""},\n\nYou're scheduled with East Coast Mechanical on ${when}${whereText}.\n\nWe'll see you then!\n\nEast Coast Mechanical`,
    });
  }

  if (customer?.phone && customer?.sms_consent) {
    await sendSMS(customer.phone, `East Coast Mechanical: You're scheduled for ${when}${whereText}.`);
  }

  if (OWNER_EMAIL) {
    const sequence = (job.ics_sequence ?? 0) + 1;
    const ics = generateJobICS({
      uid: job.id,
      sequence,
      start,
      end,
      summary: `${customer?.name ?? "Job"}${property?.address ? ` — ${property.address}` : ""}`,
      location: property?.address ?? undefined,
    });

    await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      to: OWNER_EMAIL,
      subject: `Job scheduled: ${customer?.name ?? "Unknown"} — ${when}`,
      text: `Scheduled: ${when}${whereText}.`,
      attachments: [
        {
          filename: "job.ics",
          content: Buffer.from(ics).toString("base64"),
        },
      ],
    });

    await supabase.from("jobs").update({ ics_sequence: sequence }).eq("id", jobId);
  }
}

export async function updateJobStatus(formData: FormData) {
  const id = formData.get("id") as string;
  const status = formData.get("status") as string;

  const { data: existing, error: fetchError } = await supabase
    .from("jobs")
    .select("status, completed_at, on_way_at, arrived_at")
    .eq("id", id)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const completed_at =
    status === "complete" ? existing.completed_at ?? new Date().toISOString() : existing.completed_at;

  // Going in_progress means the tech is on site and working. Stamped once, so
  // bouncing the status around doesn't restart the clock.
  const arrived_at =
    status === "in_progress" ? existing.arrived_at ?? new Date().toISOString() : existing.arrived_at;

  // Measure from arrival when we have it, and fall back to on_way_at for jobs
  // that predate arrived_at. Anything measured from on_way_at includes the
  // drive, which overstates labour on anything out past Fall River — but
  // silently re-basing old jobs would move numbers someone has already costed.
  const clockStart = arrived_at ?? existing.on_way_at;

  const tracked_hours =
    status === "complete" && clockStart && !existing.completed_at
      ? Math.round(
          ((new Date(completed_at!).getTime() - new Date(clockStart).getTime()) / 3600000) * 100
        ) / 100
      : undefined;

  const { error } = await supabase
    .from("jobs")
    .update({
      status,
      completed_at,
      ...(arrived_at !== existing.arrived_at ? { arrived_at } : {}),
      ...(tracked_hours !== undefined ? { tracked_hours } : {}),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  if (status === "scheduled" && existing.status !== "scheduled") {
    await sendScheduleNotifications(id);
  }

  await syncJobToGraph(id);
  await syncJobToPlanner(id, status);

  revalidatePath("/jobs");
}

export async function rescheduleJob(jobId: string, newDate: string) {
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
