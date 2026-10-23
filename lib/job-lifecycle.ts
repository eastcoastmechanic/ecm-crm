import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { sendSMS } from "@/lib/sms";
import { generateJobICS } from "@/lib/ics";
import { syncJobToGraph } from "@/lib/graph-connector";
import { syncJobToPlanner } from "@/lib/planner-connector";
import { formatEtDateTime } from "@/lib/tz";
import { notifyOwnerOfEvent } from "@/lib/notify-owner";

// Shared job lifecycle. The Jobs page, the truck screen, the Field Board and the
// field bot all change status through applyJobStatus so arrived_at, completed_at,
// tracked_hours, Planner/Graph sync and schedule notifications always happen.

const OWNER_EMAIL = process.env.OWNER_EMAIL;

export type CustomerContact = {
  name: string | null;
  email: string | null;
  phone: string | null;
  sms_consent: boolean | null;
} | null;
export type PropertyInfo = { address: string | null } | null;

export async function sendScheduleNotifications(jobId: string) {
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
  const when = formatEtDateTime(start);
  const whereText = property?.address ? ` at ${property.address}` : "";

  if (customer?.email) {
    await resend.emails.send({
      from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
      replyTo: RESEND_REPLY_TO,
      to: customer.email,
      subject: `You're scheduled for ${when}`,
      text: `Hi ${customer.name ?? ""},\n\nYou're scheduled with East Coast Mechanical on ${when}${whereText}.\n\nWe'll see you then!\n\nEast Coast Mechanical`,
    });
  }

  if (customer?.phone && customer?.sms_consent) {
    const sent = await sendSMS(customer.phone, `East Coast Mechanical: You're scheduled for ${when}${whereText}.`);
    if (!sent.ok) console.error(`Schedule confirmation text failed: ${sent.error}`);
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

export async function applyJobStatus(id: string, status: string) {
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

  if (status === "complete" && existing.status !== "complete") {
    await notifyOwnerOfEvent("job_completed", id);
  }

  await syncJobToGraph(id);
  await syncJobToPlanner(id, status);
}
