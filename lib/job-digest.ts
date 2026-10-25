import { formatEtTime } from "@/lib/tz";

// Morning digest of the day's jobs. Each tech gets their own jobs; the owner
// gets every job, grouped by tech, with unassigned jobs called out. No prices:
// techs read this, so it carries only what the truck card shows.

export type DigestJob = {
  id: string;
  scheduledAt: string;
  jobType: string | null;
  status: string;
  assignedStaffId: string | null;
  customer: string | null;
  phone: string | null;
  address: string | null;
  accessNotes: string | null;
};

export type DigestStaff = { id: string; name: string | null; email: string | null };

export type DigestEmail = { to: string; subject: string; text: string };

function jobLine(job: DigestJob): string {
  const lines = [
    `${formatEtTime(job.scheduledAt)}  ${job.customer ?? "Unknown customer"}${job.jobType ? ` (${job.jobType})` : ""}`,
  ];
  if (job.address) lines.push(`  ${job.address}`);
  if (job.phone) lines.push(`  Phone: ${job.phone}`);
  if (job.accessNotes) lines.push(`  Access: ${job.accessNotes}`);
  return lines.join("\n");
}

function countLabel(n: number): string {
  return `${n} job${n === 1 ? "" : "s"}`;
}

/**
 * One email per tech with jobs today, plus one for the owner listing all jobs.
 * Nobody gets an email on a day with nothing scheduled for them. A staff row
 * with the owner's email is folded into the owner's email, not sent twice.
 */
export function buildJobDigests(params: {
  jobs: DigestJob[];
  staff: DigestStaff[];
  ownerEmail: string | null;
  dayLabel: string;
  boardUrl: string | null;
}): DigestEmail[] {
  const { jobs, staff, ownerEmail, dayLabel, boardUrl } = params;
  if (jobs.length === 0) return [];

  const sorted = [...jobs].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const owner = ownerEmail?.trim().toLowerCase() || null;
  const footer = boardUrl ? `\n\nField Board: ${boardUrl}` : "";
  const emails: DigestEmail[] = [];

  const byStaff = new Map<string, DigestJob[]>();
  const unassigned: DigestJob[] = [];
  for (const job of sorted) {
    if (job.assignedStaffId && staffById.has(job.assignedStaffId)) {
      const list = byStaff.get(job.assignedStaffId) ?? [];
      list.push(job);
      byStaff.set(job.assignedStaffId, list);
    } else {
      unassigned.push(job);
    }
  }

  for (const [staffId, list] of byStaff) {
    const email = staffById.get(staffId)?.email?.trim();
    if (!email || email.toLowerCase() === owner) continue;
    emails.push({
      to: email,
      subject: `Your jobs today, ${dayLabel} (${countLabel(list.length)})`,
      text: `Your jobs for ${dayLabel}:\n\n${list.map(jobLine).join("\n\n")}${footer}`,
    });
  }

  if (ownerEmail) {
    const sections: string[] = [];
    for (const [staffId, list] of byStaff) {
      const name = staffById.get(staffId)?.name ?? "Unnamed staff";
      sections.push(`${name}:\n\n${list.map(jobLine).join("\n\n")}`);
    }
    if (unassigned.length) {
      sections.push(`Unassigned:\n\n${unassigned.map(jobLine).join("\n\n")}`);
    }
    emails.push({
      to: ownerEmail,
      subject: `Jobs today, ${dayLabel} (${countLabel(sorted.length)}${
        unassigned.length ? `, ${unassigned.length} unassigned` : ""
      })`,
      text: `All jobs for ${dayLabel}:\n\n${sections.join("\n\n----\n\n")}${footer}`,
    });
  }

  return emails;
}
