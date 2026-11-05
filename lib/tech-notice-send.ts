import { supabase } from "@/lib/supabase";
import { resend, RESEND_FROM_EMAIL, RESEND_REPLY_TO } from "@/lib/resend";
import { postToTeams } from "@/lib/teams";
import { buildTechNotice, type TechNoticeKind } from "@/lib/tech-notice";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://ecm-crm.vercel.app";

type Rel<T> = T | T[] | null;
function one<T>(value: Rel<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Tell a tech about a change to one of their jobs: email to the tech, plus a card in
 * the Teams Dispatch channel that names them. Never throws and never blocks the
 * change itself. Skipped when the tech is the person who made the change.
 */
export async function notifyTech(opts: {
  jobId: string;
  staffId: string | null | undefined;
  kind: TechNoticeKind;
  actorStaffId?: string | null;
}): Promise<void> {
  const { jobId, staffId, kind, actorStaffId } = opts;
  if (!staffId || staffId === actorStaffId) return;

  try {
    const [{ data: staff }, { data: job }] = await Promise.all([
      supabase.from("staff").select("name, email").eq("id", staffId).maybeSingle(),
      supabase
        .from("jobs")
        .select("id, scheduled_at, job_type, customers(name, phone), properties(address, access_notes)")
        .eq("id", jobId)
        .maybeSingle(),
    ]);
    if (!staff || !job) return;

    const customer = one(job.customers as Rel<{ name: string | null; phone: string | null }>);
    const property = one(job.properties as Rel<{ address: string | null; access_notes: string | null }>);

    const notice = buildTechNotice({
      kind,
      techName: staff.name ?? null,
      job: {
        id: job.id,
        scheduledAt: job.scheduled_at ?? null,
        jobType: job.job_type ?? null,
        customer: customer?.name ?? null,
        address: property?.address ?? null,
        phone: customer?.phone ?? null,
        accessNotes: property?.access_notes ?? null,
      },
    });

    if (staff.email) {
      try {
        await resend.emails.send({
          from: `East Coast Mechanical <${RESEND_FROM_EMAIL}>`,
          replyTo: RESEND_REPLY_TO,
          to: staff.email,
          subject: notice.subject,
          text: `${notice.text}\n\nOpen your jobs: ${APP_URL}/field-board`,
        });
      } catch (err) {
        console.error(`[tech-notice] email failed for job ${jobId}:`, err instanceof Error ? err.message : err);
      }
    }

    await postToTeams("dispatch", {
      title: notice.teamsTitle,
      text: notice.teamsText,
      url: `${APP_URL}/field-board`,
    });
  } catch (err) {
    console.error(`[tech-notice] failed for job ${jobId}:`, err instanceof Error ? err.message : err);
  }
}
