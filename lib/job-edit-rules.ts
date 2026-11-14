import { parseEtLocal } from "@/lib/tz";

// Pure rules for the office job editor on /jobs and the Active / Completed / Cancelled tabs.
// Jobs use both "complete" and "completed" (older rows), and both "cancelled" and "canceled".

export const JOB_TYPES = ["install", "service", "repair", "maintenance", "warranty"] as const;
export const JOB_TYPE_LABEL: Record<string, string> = {
  install: "Install",
  service: "Service",
  repair: "Repair",
  maintenance: "Maintenance",
  warranty: "Warranty",
};

export const JOB_STATUS_OPTIONS = ["requested", "scheduled", "in_progress", "complete", "cancelled"] as const;

/** Marks the "add a new address" choice in the property picker. */
export const NEW_PROPERTY_VALUE = "__new__";

export const NOTES_MAX = 2000;
export const ADDRESS_MAX = 300;

/** One spelling per status: "completed" reads as "complete", "canceled" as "cancelled". */
export function normalizeJobStatus(status: string | null | undefined): string {
  const s = (status ?? "").trim();
  if (s === "completed") return "complete";
  if (s === "canceled") return "cancelled";
  return s;
}

export function isDoneStatus(status: string | null | undefined): boolean {
  return normalizeJobStatus(status) === "complete";
}

export function isCancelledStatus(status: string | null | undefined): boolean {
  return normalizeJobStatus(status) === "cancelled";
}

export type JobTab = "active" | "completed" | "cancelled";

export function jobTab(status: string | null | undefined): JobTab {
  if (isDoneStatus(status)) return "completed";
  if (isCancelledStatus(status)) return "cancelled";
  return "active";
}

export function parseJobTab(raw: string | null | undefined): JobTab {
  return raw === "completed" || raw === "cancelled" ? raw : "active";
}

type TabJob = { status: string | null; scheduled_at: string | null; completed_at?: string | null };

function time(value: string | null | undefined): number {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

/**
 * Split jobs into the three tabs. Active keeps the order it was given. Completed and
 * cancelled are newest first: by when the job was finished, else its scheduled time.
 */
export function splitJobsByTab<T extends TabJob>(jobs: T[]): Record<JobTab, T[]> {
  const out: Record<JobTab, T[]> = { active: [], completed: [], cancelled: [] };
  for (const job of jobs) out[jobTab(job.status)].push(job);
  const newestFirst = (a: T, b: T) =>
    time(b.completed_at ?? b.scheduled_at) - time(a.completed_at ?? a.scheduled_at);
  out.completed.sort(newestFirst);
  out.cancelled.sort(newestFirst);
  return out;
}

/** What the editor form sends. A field the form did not send is null and means "leave it". */
export type JobEditInput = {
  customerId: string | null;
  originalCustomerId: string | null;
  propertyId: string | null;
  originalPropertyId: string | null;
  newAddress: string | null;
  jobType: string | null;
  originalJobType: string | null;
  notes: string | null;
  originalNotes: string | null;
  staffId: string | null;
  originalStaffId: string | null;
  scheduledAt: string | null;
  originalScheduledAt: string | null;
  status: string | null;
  originalStatus: string | null;
};

export type JobEditChanges = {
  /** "" clears the customer. */
  customerId?: string;
  /** "" clears the address. */
  propertyId?: string;
  /** Set when a new address is to be added for the job's customer. */
  newAddress?: string;
  jobType?: string;
  /** "" clears the notes. */
  notes?: string;
  /** "" unassigns. */
  staffId?: string;
  /** New York wall-clock "YYYY-MM-DDTHH:MM". */
  scheduledAt?: string;
  /** Normalized ("complete", not "completed"). */
  status?: string;
};

const trim = (v: string | null) => (v ?? "").trim();

/**
 * Which fields the office really changed (the submitted value differs from what the form
 * showed), checked. Comparing to what the form showed, not the database, means a field the
 * person did not touch never overwrites a change someone else made meanwhile.
 */
export function parseJobEdit(input: JobEditInput): { error: string } | { changes: JobEditChanges } {
  const changes: JobEditChanges = {};
  const changed = (value: string | null, original: string | null) => value !== null && trim(value) !== trim(original);

  const customerChanged = changed(input.customerId, input.originalCustomerId);
  if (customerChanged) changes.customerId = trim(input.customerId);

  const pickedProperty = trim(input.propertyId);
  if (input.propertyId !== null && pickedProperty === NEW_PROPERTY_VALUE) {
    const address = trim(input.newAddress).replace(/\s+/g, " ");
    if (!address) return { error: "Type the new address, or pick one from the list." };
    if (address.length > ADDRESS_MAX) return { error: `Keep the address under ${ADDRESS_MAX} characters.` };
    const customerAfter = customerChanged ? changes.customerId : trim(input.originalCustomerId);
    if (!customerAfter) return { error: "Pick a customer before adding a new address." };
    changes.newAddress = address;
  } else if (changed(input.propertyId, input.originalPropertyId)) {
    changes.propertyId = pickedProperty;
  } else if (customerChanged && trim(input.originalPropertyId)) {
    // The old address belongs to the old customer: don't leave it on the job silently.
    return { error: "You changed the customer. Pick that customer's address too (or No address)." };
  }

  if (changed(input.jobType, input.originalJobType)) {
    const jobType = trim(input.jobType);
    if (!(JOB_TYPES as readonly string[]).includes(jobType)) return { error: "Pick a job type." };
    changes.jobType = jobType;
  }

  if (changed(input.notes, input.originalNotes)) {
    const notes = trim(input.notes);
    if (notes.length > NOTES_MAX) return { error: `Keep the job notes under ${NOTES_MAX} characters.` };
    changes.notes = notes;
  }

  if (changed(input.staffId, input.originalStaffId)) changes.staffId = trim(input.staffId);

  if (changed(input.scheduledAt, input.originalScheduledAt)) {
    const when = trim(input.scheduledAt);
    if (!when) return { error: "A job's time can be moved but not cleared. Pick a date and time." };
    if (!parseEtLocal(when)) return { error: "Pick a valid date and time." };
    changes.scheduledAt = when.slice(0, 16);
  }

  if (input.status !== null && normalizeJobStatus(input.status) !== normalizeJobStatus(input.originalStatus)) {
    const status = normalizeJobStatus(input.status);
    if (!(JOB_STATUS_OPTIONS as readonly string[]).includes(status)) return { error: "Pick a status." };
    changes.status = status;
  }

  return { changes };
}

export const DONE_REASON_MIN = 5;

/**
 * Office or owner marking a job done when the truck checklist or photo is not finished: it
 * goes through, but only with a reason, logged like the owner unlock. No blockers: no reason
 * needed and nothing extra is logged.
 */
export function officeDoneGate(
  blockers: string[],
  reason: string | null | undefined
): { ok: true; logReason: string | null } | { ok: false; error: string } {
  if (blockers.length === 0) return { ok: true, logReason: null };
  const why = (reason ?? "").trim();
  if (why.length < DONE_REASON_MIN) {
    return {
      ok: false,
      error: `Not finished on the truck yet: ${blockers.join(" ")} To mark it done anyway, say why below.`,
    };
  }
  return { ok: true, logReason: `Marked done from Jobs: ${why}`.slice(0, 500) };
}

/** True when closing (done or cancelled) should run before a time change, so the move sends no "you're scheduled" notice. */
export function statusBeforeTime(nextStatus: string | undefined): boolean {
  return nextStatus === "complete" || nextStatus === "cancelled";
}
