import { etDateKey, formatEtDateTime } from "@/lib/tz";

// The message a tech gets when a job is assigned to them, moved, cancelled or taken
// away. Pure text building, so it is easy to test. No prices: techs read this.

export type TechNoticeKind = "assigned" | "rescheduled" | "cancelled" | "unassigned";

export type NoticeJob = {
  id: string;
  scheduledAt: string | null;
  jobType: string | null;
  customer: string | null;
  address: string | null;
  phone: string | null;
  accessNotes: string | null;
};

export type TechNotice = {
  subject: string;
  text: string;
  teamsTitle: string;
  teamsText: string;
};

const VERB: Record<TechNoticeKind, string> = {
  assigned: "New job",
  rescheduled: "Job moved",
  cancelled: "Job cancelled",
  unassigned: "Job taken off you",
};

export function buildTechNotice(input: {
  kind: TechNoticeKind;
  techName: string | null;
  job: NoticeJob;
  now?: Date;
}): TechNotice {
  const { kind, job } = input;
  const now = input.now ?? new Date();
  const tech = input.techName?.trim() || "Tech";
  const when = job.scheduledAt ? formatEtDateTime(job.scheduledAt) : "not scheduled yet";
  const today = job.scheduledAt ? etDateKey(new Date(job.scheduledAt)) === etDateKey(now) : false;
  const tag = today && kind !== "cancelled" && kind !== "unassigned" ? "TODAY: " : "";
  const customer = job.customer ?? "Unknown customer";
  const type = job.jobType ? ` (${job.jobType})` : "";

  const lines = [`${VERB[kind]}: ${customer}${type}`, `When: ${when}`];
  if (job.address) lines.push(`Where: ${job.address}`);
  // Details only matter for a job the tech will actually work.
  if (kind === "assigned" || kind === "rescheduled") {
    if (job.phone) lines.push(`Phone: ${job.phone}`);
    if (job.accessNotes) lines.push(`Access: ${job.accessNotes}`);
  }
  const text = lines.join("\n");

  return {
    subject: `${tag}${VERB[kind]}: ${customer}${job.scheduledAt ? ` - ${when}` : ""}`,
    text,
    teamsTitle: `${tag}${VERB[kind]} for ${tech}`,
    teamsText: `${tech}: ${text.replaceAll("\n", " | ")}`,
  };
}
