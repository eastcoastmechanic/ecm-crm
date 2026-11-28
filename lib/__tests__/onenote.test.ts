import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../token-crypto";
import {
  JOB_NOTES_PAGE_TITLE,
  NO_ADDRESS_SECTION,
  altSectionGroupName,
  escapeHtml,
  jobSectionName,
  noteHtml,
  pageHtml,
  pageTitle,
  sectionGroupNameForAddress,
  sectionNameForAddress,
} from "../onenote-rules";

describe("token encryption", () => {
  const secret = "test-private-key-material";

  it("round-trips and never stores the plain token", () => {
    const sealed = encryptToken("refresh-abc", secret, "p");
    expect(sealed).not.toContain("refresh-abc");
    expect(decryptToken(sealed, secret, "p")).toBe("refresh-abc");
  });

  it("refuses a tampered value, another key, or another purpose", () => {
    const sealed = encryptToken("refresh-abc", secret, "p");
    const parts = sealed.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(decryptToken(parts.join("."), secret, "p")).toBeNull();
    expect(decryptToken(sealed, "other-key", "p")).toBeNull();
    expect(decryptToken(sealed, secret, "other")).toBeNull();
    expect(decryptToken("junk", secret, "p")).toBeNull();
  });
});

describe("sectionNameForAddress", () => {
  it("matches the folder wording", () => {
    expect(sectionNameForAddress("17 Lisas Ln, Pembroke, MA 02359")).toBe("17 Lisas Ln Pembroke");
  });

  it("drops characters OneNote refuses in section names and keeps 50 or fewer", () => {
    const name = sectionNameForAddress("12 O'Brien Rd & Main St #4, Plymouth");
    expect(name).not.toMatch(/[?*\\/:<>|&#'"%~]/);
    expect(sectionNameForAddress("1 " + "Very Long Street Name ".repeat(5) + ", Hingham").length).toBeLessThanOrEqual(50);
  });

  it("uses one shared section when there is no address", () => {
    expect(sectionNameForAddress(null)).toBe(NO_ADDRESS_SECTION);
    expect(sectionNameForAddress("  ")).toBe(NO_ADDRESS_SECTION);
  });
});

describe("page and note HTML", () => {
  const job = {
    customerName: "Jane Smith",
    jobType: "install",
    address: "17 Lisas Ln, Pembroke",
    scheduledAt: "2026-11-07T03:30:00Z", // Nov 6, 10:30 PM in New York
    createdAt: "2026-11-01T12:00:00Z",
  };

  it("titles the page by customer, type and the New York date", () => {
    expect(pageTitle(job)).toBe("Jane Smith · Install · Nov 6, 2026");
    expect(pageTitle({ ...job, customerName: null, jobType: null, scheduledAt: null })).toBe(
      "No customer · Job · Nov 1, 2026"
    );
  });

  it("puts the notes being copied on the new page, oldest first", () => {
    const html = pageHtml(job, "https://x/jobs", [
      { authorName: "Josh", createdAt: "2026-11-07T01:00:00Z", body: "first" },
      { authorName: "Mike", createdAt: "2026-11-07T02:00:00Z", body: "second" },
    ]);
    expect(html.indexOf("first")).toBeGreaterThan(html.indexOf("Open this job in the CRM"));
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
    expect(pageHtml(job, "https://x/jobs")).not.toContain("<b>");
  });

  it("escapes customer text everywhere", () => {
    const html = pageHtml({ ...job, customerName: "<script>x</script>", address: "1 A & B St" }, "https://x/jobs");
    expect(html).not.toContain("<script>");
    expect(html).toContain("1 A &amp; B St");
    expect(noteHtml({ authorName: "Josh", createdAt: job.createdAt, body: "<b>hi</b>\nline 2" })).toContain(
      "&lt;b&gt;hi&lt;/b&gt;<br />line 2"
    );
    expect(escapeHtml(`"'`)).toBe("&quot;&#39;");
  });
});

const FORBIDDEN = /[?*\/:<>|&#'"%~]/;

describe("section group per address", () => {
  it("uses the folder wording, and No address when there is none", () => {
    expect(sectionGroupNameForAddress("17 Lisas Ln, Pembroke, MA 02359")).toBe("17 Lisas Ln Pembroke");
    expect(sectionGroupNameForAddress(null)).toBe(NO_ADDRESS_SECTION);
  });

  it("has a second-choice name within the limits", () => {
    expect(altSectionGroupName("17 Lisas Ln Pembroke")).toBe("17 Lisas Ln Pembroke Jobs");
    const long = altSectionGroupName("x".repeat(50));
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith(" Jobs")).toBe(true);
  });
});

describe("jobSectionName", () => {
  const job = {
    id: "1a2b3c4d-5e6f-7a8b-9c0d-112233445566",
    jobType: "install",
    scheduledAt: "2026-11-07T03:30:00Z", // Nov 6, 10:30 PM in New York
    createdAt: "2026-11-01T12:00:00Z",
  };

  it("names the section by type, New York date and short job id", () => {
    expect(jobSectionName(job)).toBe("Install · Nov 6, 2026 · 1a2b3c4d");
  });

  it("falls back to the day the job was made and to Job", () => {
    expect(jobSectionName({ ...job, scheduledAt: null, jobType: null })).toBe("Job · Nov 1, 2026 · 1a2b3c4d");
  });

  it("keeps two jobs on the same day apart", () => {
    expect(jobSectionName(job)).not.toBe(jobSectionName({ ...job, id: "9f8e7d6c-0000-0000-0000-000000000000" }));
  });

  it("stays within OneNote limits even with an odd job type", () => {
    const name = jobSectionName({ ...job, jobType: "a/b:c?" + "very long type ".repeat(6) });
    expect(name.length).toBeLessThanOrEqual(50);
    expect(name).not.toMatch(FORBIDDEN);
    expect(name.endsWith("Nov 6, 2026 · 1a2b3c4d")).toBe(true);
  });
});

describe("Job notes page in a job section", () => {
  const job = {
    customerName: "Jane Smith",
    jobType: "install",
    address: "17 Lisas Ln, Pembroke",
    scheduledAt: "2026-11-07T03:30:00Z",
    createdAt: "2026-11-01T12:00:00Z",
  };

  it("is titled Job notes and keeps the customer, type and date line first", () => {
    const html = pageHtml(job, "https://x/jobs", [], JOB_NOTES_PAGE_TITLE);
    expect(html).toContain("<title>Job notes</title>");
    expect(html).toContain("<p><b>Jane Smith · Install · Nov 6, 2026</b></p>");
    expect(html.indexOf("Jane Smith")).toBeLessThan(html.indexOf("17 Lisas Ln"));
  });

  it("leaves the older page layout unchanged", () => {
    expect(pageHtml(job, "https://x/jobs")).toContain("<title>Jane Smith · Install · Nov 6, 2026</title>");
  });
});
