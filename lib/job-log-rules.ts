// Pure rules for the job log file kept in the property's SharePoint folder.
// No database or Microsoft imports, so it is all unit tested.
//
// Techs can open that folder (the Notebook shows them its link), so the log never prints a money
// amount: invoices show their number and status only, receipts their vendor and date only.

import { BUSINESS_TZ, etDateKey } from "@/lib/tz";
import { jobShortId } from "@/lib/job-file-rules";

export type JobLogInput = {
  job: {
    id: string;
    job_type: string | null;
    status: string | null;
    created_at: string | null;
    scheduled_at: string | null;
    on_way_at: string | null;
    arrived_at: string | null;
    completed_at: string | null;
    notes: string | null;
    created_via: string | null;
  };
  customerName: string | null;
  address: string | null;
  assignedTech: string | null;
  linkedDoc: { doc_number: string | null; type: string | null; status: string | null } | null;
  timeEntries: { staff: string | null; kind: string; started_at: string; ended_at: string | null; note: string | null; voided_at?: string | null }[];
  notes: { author_name: string | null; body: string; created_at: string }[];
  photos: { phase: string | null; caption: string | null; taken_at: string | null; link: string | null }[];
  receipts: { vendor: string; purchased_on: string | null; note: string | null; uploaded_by_name: string | null; created_at: string; link: string | null }[];
  invoices: { doc_number: string | null; status: string | null; created_at: string | null; sent_at: string | null; paid_at: string | null }[];
  reports: { doc_number: string | null; created_at: string | null }[];
  builtAt: Date;
};

const TYPE_LABEL: Record<string, string> = {
  service: "Service",
  install: "Install",
  maintenance: "Maintenance",
};

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  scheduled: "Scheduled",
  in_progress: "In progress",
  complete: "Done",
  completed: "Done",
  cancelled: "Cancelled",
  canceled: "Cancelled",
};

export function jobTypeLabel(type: string | null | undefined): string {
  if (!type) return "Job";
  return TYPE_LABEL[type] ?? type.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * The log's file name, at the top of the property folder. Built from things that never change
 * (the day the job was made, its type and id), so every rebuild replaces the same file.
 */
export function jobLogFileName(job: { id: string; job_type: string | null; created_at: string | null }): string {
  const created = job.created_at ? new Date(job.created_at) : null;
  const date = created && !Number.isNaN(created.getTime()) ? etDateKey(created) : "undated";
  return `${date} ${jobTypeLabel(job.job_type)} ${jobShortId(job.id)} - Job log.txt`;
}

/** "Thu, Nov 13, 2026, 2:05 PM" in New York. */
export function logTime(iso: string | Date): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: BUSINESS_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).replace(/[  ]/g, " "); // ICU puts a narrow space before AM/PM; plain text wants a normal one
}

function validTime(v: string | null | undefined): v is string {
  return Boolean(v) && !Number.isNaN(new Date(v as string).getTime());
}

/** Work hours from timers, voided ones skipped, open ones ignored. Rounded to 0.01. */
export function clockedWorkHours(entries: JobLogInput["timeEntries"]): number {
  let ms = 0;
  for (const e of entries) {
    if (e.kind !== "work" || e.voided_at || !e.ended_at) continue;
    const d = new Date(e.ended_at).getTime() - new Date(e.started_at).getTime();
    if (d > 0) ms += d;
  }
  return Math.round((ms / 3_600_000) * 100) / 100;
}

type Event = { at: number; order: number; text: string };

/** The whole log as plain text (Windows line endings so Notepad shows it right). */
export function buildJobLogText(input: JobLogInput): string {
  const { job } = input;
  const events: Event[] = [];
  let order = 0;
  const add = (at: string | null | undefined, text: string) => {
    if (validTime(at)) events.push({ at: new Date(at).getTime(), order: order++, text });
  };

  const source = job.created_via ? ` (${job.created_via.replaceAll("_", " ")})` : "";
  add(job.created_at, `Job created${source}`);
  add(job.on_way_at, "On my way");
  add(job.arrived_at, "Arrived on site");

  for (const e of input.timeEntries) {
    if (e.voided_at) continue;
    const who = e.staff ?? "Tech";
    const what = e.kind === "drive" ? "drive time" : "work";
    add(e.started_at, `${who} started ${what}`);
    if (e.ended_at) add(e.ended_at, e.note === "paused" ? `${who} paused ${what}` : `${who} stopped ${what}`);
  }

  add(job.completed_at, "Job done");

  for (const n of input.notes) add(n.created_at, `Note from ${n.author_name ?? "Office"}:\r\n    ${n.body.replace(/\r?\n/g, "\r\n    ")}`);

  for (const p of input.photos) {
    const label = [p.phase ? `${p.phase}` : null, p.caption].filter(Boolean).join(", ");
    add(p.taken_at, `Photo added${label ? ` (${label})` : ""}${p.link ? `: ${p.link}` : ""}`);
  }

  for (const r of input.receipts) {
    const bits = [r.purchased_on ? `dated ${r.purchased_on}` : null, r.note, r.uploaded_by_name ? `added by ${r.uploaded_by_name}` : null]
      .filter(Boolean)
      .join(", ");
    add(r.created_at, `Receipt from ${r.vendor}${bits ? ` (${bits})` : ""}${r.link ? `: ${r.link}` : ""}`);
  }

  for (const rep of input.reports) add(rep.created_at, `Service report ${rep.doc_number ?? ""} started`.replace("  ", " "));

  for (const inv of input.invoices) {
    const num = inv.doc_number ?? "(no number)";
    add(inv.created_at, `Invoice ${num} created`);
    add(inv.sent_at, `Invoice ${num} sent to the customer`);
    add(inv.paid_at, `Invoice ${num} paid`);
    if (inv.status === "void") add(inv.created_at, `Invoice ${num} is void`);
  }

  events.sort((a, b) => a.at - b.at || a.order - b.order);

  const lines: string[] = [];
  lines.push(`JOB LOG - ${jobTypeLabel(job.job_type)} job ${jobShortId(job.id)}`);
  lines.push("=".repeat(48));
  if (input.customerName) lines.push(`Customer:   ${input.customerName}`);
  if (input.address) lines.push(`Address:    ${input.address}`);
  lines.push(`Status:     ${STATUS_LABEL[job.status ?? ""] ?? job.status ?? "Unknown"}`);
  lines.push(`Scheduled:  ${validTime(job.scheduled_at) ? logTime(job.scheduled_at) : "Not scheduled"}`);
  lines.push(`Tech:       ${input.assignedTech ?? "Not assigned"}`);
  if (input.linkedDoc?.doc_number) {
    lines.push(`For:        ${input.linkedDoc.type ?? "document"} ${input.linkedDoc.doc_number}${input.linkedDoc.status ? ` (${input.linkedDoc.status})` : ""}`);
  }
  const hours = clockedWorkHours(input.timeEntries);
  if (hours > 0) lines.push(`Clocked work: ${hours} h`);
  if (input.invoices.length > 0) {
    lines.push(`Invoices:   ${input.invoices.map((i) => `${i.doc_number ?? "(no number)"} ${i.status ?? ""}`.trim()).join(", ")}`);
  }
  if (job.notes?.trim()) {
    lines.push("");
    lines.push("Job description:");
    lines.push(`    ${job.notes.trim().replace(/\r?\n/g, "\r\n    ")}`);
  }
  lines.push("");
  lines.push("WHAT HAPPENED (New York time)");
  lines.push("-".repeat(48));
  if (events.length === 0) lines.push("Nothing logged yet.");
  for (const e of events) lines.push(`${logTime(new Date(e.at))}  ${e.text}`);
  lines.push("");
  lines.push(`Rebuilt from the CRM ${logTime(input.builtAt)}. This file is rewritten every time something`);
  lines.push("happens on the job, so edits made here are lost. Add notes in the CRM job Notebook.");
  return lines.join("\r\n") + "\r\n";
}
