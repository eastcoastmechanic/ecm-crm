// Pure rules for the shared "ECM Jobs" OneNote notebook: one section per
// address, one page per job, each CRM note appended to the job's page.
// No network or database here, so it can be tested.

import { folderNameForAddress } from "@/lib/job-folder-rules";

export const NO_ADDRESS_SECTION = "No address";
const SECTION_MAX = 50;
// OneNote refuses these in section names.
const SECTION_FORBIDDEN = /[?*\\/:<>|&#'"%~]/g;

/** Section for an address: same wording as the SharePoint folder ("17 Lisas Ln Pembroke"), within OneNote's limits. */
export function sectionNameForAddress(address: string | null | undefined): string {
  const base = folderNameForAddress(address);
  if (!base) return NO_ADDRESS_SECTION;
  const cleaned = base.replace(SECTION_FORBIDDEN, " ").replace(/\s+/g, " ").trim().slice(0, SECTION_MAX).trim();
  return cleaned.length >= 3 ? cleaned : NO_ADDRESS_SECTION;
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

/** The page as first created: title, address and a link back to the job in the CRM. Notes are appended after. */
export function pageHtml(job: PageJob, crmJobUrl: string): string {
  const title = escapeHtml(pageTitle(job));
  return [
    "<!DOCTYPE html><html><head>",
    `<title>${title}</title>`,
    '<meta name="created" content="' + new Date(job.createdAt).toISOString() + '" />',
    "</head><body>",
    `<p>${escapeHtml(job.address?.trim() || "No address on file")}</p>`,
    `<p><a href="${escapeHtml(crmJobUrl)}">Open this job in the CRM</a></p>`,
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
