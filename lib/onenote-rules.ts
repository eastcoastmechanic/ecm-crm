// Pure rules for the shared "ECM Jobs" OneNote notebook. New jobs: a section
// group per address, a section per job, a "Job notes" page in it that each CRM
// note is appended to. Older jobs keep their page in a section per address.
// No network or database here, so it can be tested.

import { folderNameForAddress } from "@/lib/job-folder-rules";

export const NO_ADDRESS_SECTION = "No address";
const SECTION_MAX = 50;
// OneNote refuses these in section and section group names.
const SECTION_FORBIDDEN = /[?*\\/:<>|&#'"%~]/g;

/** Strip what OneNote refuses in section and section group names and keep it to 50 characters. */
function cleanName(value: string): string {
  return value.replace(SECTION_FORBIDDEN, " ").replace(/\s+/g, " ").trim().slice(0, SECTION_MAX).trim();
}

/** Section for an address: same wording as the SharePoint folder ("17 Lisas Ln Pembroke"), within OneNote's limits. */
export function sectionNameForAddress(address: string | null | undefined): string {
  const base = folderNameForAddress(address);
  if (!base) return NO_ADDRESS_SECTION;
  const cleaned = cleanName(base);
  return cleaned.length >= 3 ? cleaned : NO_ADDRESS_SECTION;
}

/** Section group for an address (new layout): same wording as the folder, "No address" when there is none. */
export function sectionGroupNameForAddress(address: string | null | undefined): string {
  return sectionNameForAddress(address);
}

/**
 * Second choice when OneNote will not make the group under its plain name (for
 * example an older per-address section already has that name): "17 Lisas Ln Pembroke Jobs".
 */
export function altSectionGroupName(name: string): string {
  const suffix = " Jobs";
  return cleanName(name.slice(0, SECTION_MAX - suffix.length).trim() + suffix);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function etDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function etDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function typeLabel(jobType: string | null): string {
  const t = (jobType ?? "").replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Job";
}

export type SectionJob = { id: string; jobType: string | null; scheduledAt: string | null; createdAt: string };

/**
 * A job's own section: "Install · Nov 6, 2026 · 1a2b3c4d" (scheduled date, else the day the job
 * was made, New York time, then the start of the job id so two jobs on one day never share a name).
 * The name is fixed by the job, so two runs making it at once land on the same section.
 */
export function jobSectionName(job: SectionJob): string {
  const shortId = job.id.replace(/-/g, "").slice(0, 8);
  const tail = ` · ${etDate(job.scheduledAt ?? job.createdAt)} · ${shortId}`;
  const type = cleanName(typeLabel(job.jobType)).slice(0, SECTION_MAX - tail.length).trim() || "Job";
  return cleanName(type + tail);
}

export type PageJob = {
  customerName: string | null;
  jobType: string | null;
  address: string | null;
  scheduledAt: string | null;
  createdAt: string;
};

/** "Jane Smith · Install · Nov 6, 2026" (scheduled date, else the day the job was made, New York time). */
export function pageTitle(job: PageJob): string {
  const type = job.jobType ? job.jobType.charAt(0).toUpperCase() + job.jobType.slice(1) : "Job";
  return [job.customerName?.trim() || "No customer", type, etDate(job.scheduledAt ?? job.createdAt)].join(" · ");
}

/** Title of the notes page inside a job's own section (new layout). */
export const JOB_NOTES_PAGE_TITLE = "Job notes";

/**
 * The page as first created: title, address, a link back to the CRM, and the
 * notes being copied now. Notes go in with the page because a brand-new
 * OneNote page can answer 404 to an update for a few seconds. Later notes are appended.
 * With `pageName` (a job's own section) the page is called that, and the
 * customer · type · date line becomes the first line on the page.
 */
export function pageHtml(job: PageJob, crmJobUrl: string, notes: PageNote[] = [], pageName?: string): string {
  const header = escapeHtml(pageTitle(job));
  const title = pageName ? escapeHtml(pageName) : header;
  return [
    "<!DOCTYPE html><html><head>",
    `<title>${title}</title>`,
    '<meta name="created" content="' + new Date(job.createdAt).toISOString() + '" />',
    "</head><body>",
    ...(pageName ? [`<p><b>${header}</b></p>`] : []),
    `<p>${escapeHtml(job.address?.trim() || "No address on file")}</p>`,
    `<p><a href="${escapeHtml(crmJobUrl)}">Open this job in the CRM</a></p>`,
    ...notes.map(noteHtml),
    "</body></html>",
  ].join("");
}

export type PageNote = { authorName: string | null; createdAt: string; body: string };

/** One CRM note as a OneNote paragraph: who and when in bold, then the text (line breaks kept). */
export function noteHtml(note: PageNote): string {
  const who = escapeHtml(note.authorName?.trim() || "Office");
  const body = escapeHtml(note.body).replace(/\r?\n/g, "<br />");
  return `<p><b>${who} · ${escapeHtml(etDateTime(note.createdAt))}</b><br />${body}</p>`;
}
