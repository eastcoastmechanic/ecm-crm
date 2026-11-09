import { supabase } from "@/lib/supabase";
import { createPortalServerClient } from "@/lib/supabase-portal/server";
import { requireRole, type StaffRole } from "@/lib/require-role";
import { jobAccessError, jobAccessMessage } from "@/lib/job-access-rules";

export { TECH_STATUSES, jobAccessError, jobAccessMessage } from "@/lib/job-access-rules";

/** The signed-in staff member's id, or null (shared Basic-auth login, no staff row, signed out). */
export async function getMyStaffId(): Promise<string | null> {
  try {
    const authClient = await createPortalServerClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from("staff").select("id").eq("auth_user_id", user.id).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Call inside any server action that changes or adds to one job. Office and owner
 * pass. A tech passes only for a job that is theirs (see jobAccessError). Throws
 * Error("Not allowed") style errors, like requireRole.
 */
export async function requireJobAccess(
  jobId: string | null | undefined,
  opts: { nextStatus?: string | null; allowClosedJob?: boolean } = {}
): Promise<StaffRole> {
  const role = await requireRole(["owner", "office", "tech"]);
  if (role !== "tech") return role;
  if (!jobId) throw new Error("Not allowed");
  const [{ data: job }, myStaffId] = await Promise.all([
    supabase.from("jobs").select("assigned_staff_id, status").eq("id", jobId).maybeSingle(),
    getMyStaffId(),
  ]);
  const error = jobAccessError({
    role,
    myStaffId,
    job: job ? { assigned_staff_id: job.assigned_staff_id ?? null, status: job.status ?? null } : null,
    nextStatus: opts.nextStatus,
    allowClosedJob: opts.allowClosedJob,
  });
  if (error) throw new Error(error);
  return role;
}

export type JobAccessResult = { role: StaffRole; error?: undefined } | { error: string; role?: undefined };

/**
 * Same rule as requireJobAccess, but returns { error } instead of throwing, for
 * server actions that show the reason on the page and for pages that decide
 * whether to show a report. With no job, only office and owner pass (a tech
 * always needs a job that is theirs or not yet assigned).
 */
export async function checkJobAccess(
  jobId: string | null | undefined,
  opts: { nextStatus?: string | null; allowClosedJob?: boolean } = {}
): Promise<JobAccessResult> {
  try {
    return { role: await requireJobAccess(jobId, opts) };
  } catch (err) {
    return { error: jobAccessMessage(err) };
  }
}
