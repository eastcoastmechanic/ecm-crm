import type { StaffRole } from "@/lib/require-role";

// Rules for what a tech may do to a job. Office and owner are not limited here.
// A tech may act on a job that is assigned to them or not assigned to anyone yet
// (the truck screen lets a tech pick any open job). They cannot touch a job that
// is assigned to someone else, cannot reopen a finished or cancelled job, and can
// only move a job to In progress or Finish.

export const TECH_STATUSES = ["in_progress", "complete"] as const;
const CLOSED_STATUSES = ["complete", "completed", "cancelled", "canceled"];

export type JobAccessInput = {
  role: StaffRole;
  myStaffId: string | null;
  job: { assigned_staff_id: string | null; status: string | null } | null;
  /** The status the caller wants to set, if this is a status change. */
  nextStatus?: string | null;
  /** True for actions that add to a finished job (photos, notes). */
  allowClosedJob?: boolean;
};

/** Returns an error message, or null when the action is allowed. Pure, so it is easy to test. */
export function jobAccessError(input: JobAccessInput): string | null {
  if (input.role !== "tech") return null;
  if (!input.job) return "Job not found";
  if (!input.myStaffId) return "Not allowed";
  const { assigned_staff_id: assignee, status } = input.job;
  if (assignee && assignee !== input.myStaffId) return "This job is assigned to someone else";
  if (input.nextStatus !== undefined && input.nextStatus !== null) {
    if (!(TECH_STATUSES as readonly string[]).includes(input.nextStatus)) return "Not allowed";
  }
  const closed = status !== null && CLOSED_STATUSES.includes(status);
  if (closed && !input.allowClosedJob) return "This job is already closed";
  return null;
}

/**
 * Turns an error thrown by requireRole / requireJobAccess into a message for the page.
 * "Not allowed" (wrong role, no staff row, no job) gets a plain sentence; the job rules'
 * own messages ("This job is assigned to someone else") are already plain and pass through.
 */
export function jobAccessMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (!message || message === "Not allowed") return "You can't work on this job.";
  return message;
}
