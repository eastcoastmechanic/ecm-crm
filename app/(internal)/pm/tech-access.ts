import { headers } from "next/headers";
import { supabase } from "@/lib/supabase";
import { checkJobAccess } from "@/lib/job-access";

/** True when the signed-in user is a tech (proxy.ts sets this header on every internal path). */
export async function isTechRequest(): Promise<boolean> {
  return (await headers()).get("x-staff-role") === "tech";
}

/**
 * Whether the signed-in user may open this PM checklist (page, report or PDF).
 * Office and owner always may. A tech may only for a checklist whose job is
 * theirs (or not yet assigned), the same rule as the checklist's save actions
 * and the service and install report pages (#172). Checked before the
 * checklist itself is read, so nothing about it reaches a tech who can't open it.
 */
export async function mayOpenChecklist(checklistId: string): Promise<boolean> {
  if (!(await isTechRequest())) return true;
  const { data, error } = await supabase.from("pm_checklists").select("job_id").eq("id", checklistId).maybeSingle();
  if (error || !data) return false;
  const access = await checkJobAccess(data.job_id as string | null, { allowClosedJob: true });
  return access.error === undefined;
}
