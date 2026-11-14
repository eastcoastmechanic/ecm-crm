import { describe, expect, it } from "vitest";
import {
  cleanNamePart,
  copySummaryLine,
  fileExtension,
  jobShortId,
  MAX_COPY_ATTEMPTS,
  receiptDate,
  sharePointPathFor,
  shouldTryCopy,
  summarizeCopies,
} from "@/lib/job-file-rules";

const JOB = "1a2b3c4d-5e6f-7a8b-9c0d-112233445566";

describe("sharePointPathFor", () => {
  it("names a photo by New York date, job short id, phase and a piece of its own id", () => {
    // 02:30 UTC on the 14th is still the 13th in New York.
    expect(
      sharePointPathFor({ kind: "photo", jobId: JOB, storagePath: "9f8e7d6c-aaaa-bbbb-cccc-dddd-photo.jpg", label: "arrival", createdAt: "2026-11-14T02:30:00Z" })
    ).toBe("Photos/2026-11-13 job 1a2b3c4d arrival 9f8e7d.jpg");
  });

  it("puts receipts in Receipts with the vendor, and takes the extension from the content type when the path has none", () => {
    expect(
      sharePointPathFor({ kind: "receipt", jobId: JOB, storagePath: `${JOB}/abcdef12-0000`, label: "Home Depot", createdAt: "2026-11-13T15:00:00Z", contentType: "application/pdf" })
    ).toBe("Receipts/2026-11-13 job 1a2b3c4d Home Depot abcdef.pdf");
  });

  it("strips characters SharePoint refuses from the label", () => {
    expect(
      sharePointPathFor({ kind: "receipt", jobId: JOB, storagePath: "x/123456.png", label: 'F.W. Webb: "Plymouth" #4', createdAt: "2026-11-13T15:00:00Z" })
    ).toBe("Receipts/2026-11-13 job 1a2b3c4d F.W. Webb Plymouth 4 123456.png");
  });

  it("is the same every time for the same file, so a retry replaces instead of duplicating", () => {
    const input = { kind: "photo" as const, jobId: JOB, storagePath: "abc123-x.jpg", label: null, createdAt: "2026-11-13T15:00:00Z" };
    expect(sharePointPathFor(input)).toBe(sharePointPathFor(input));
    expect(sharePointPathFor(input)).toBe("Photos/2026-11-13 job 1a2b3c4d abc123.jpg");
  });
});

describe("small helpers", () => {
  it("jobShortId drops dashes and keeps 8", () => {
    expect(jobShortId(JOB)).toBe("1a2b3c4d");
  });
  it("cleanNamePart trims, collapses and limits", () => {
    expect(cleanNamePart("  a//b  ")).toBe("a b");
    expect(cleanNamePart(null)).toBe("");
    expect(cleanNamePart("x".repeat(60)).length).toBe(40);
    expect(cleanNamePart("Supply Co. ")).toBe("Supply Co");
  });
  it("fileExtension prefers the name, then the type, then jpg", () => {
    expect(fileExtension("a.PNG")).toBe("png");
    expect(fileExtension("a", "application/pdf")).toBe("pdf");
    expect(fileExtension(null, null)).toBe("jpg");
  });
});

describe("copy retries", () => {
  it("tries pending, skipped and failed copies until the attempts run out, never copied ones", () => {
    expect(shouldTryCopy({ status: "pending", attempts: 9 })).toBe(true);
    expect(shouldTryCopy({ status: "failed", attempts: MAX_COPY_ATTEMPTS - 1 })).toBe(true);
    expect(shouldTryCopy({ status: "failed", attempts: MAX_COPY_ATTEMPTS })).toBe(false);
    expect(shouldTryCopy({ status: "skipped", attempts: 1 })).toBe(true);
    expect(shouldTryCopy({ status: "copied", attempts: 0 })).toBe(false);
  });

  it("summarizes for the office", () => {
    const s = summarizeCopies([{ status: "copied" }, { status: "copied" }, { status: "failed" }, { status: "pending" }]);
    expect(s).toEqual({ copied: 2, waiting: 1, failed: 1, skipped: 0 });
    expect(copySummaryLine(s)).toBe("2 of 4 files copied to the job folder, 1 waiting, 1 failed.");
    expect(copySummaryLine(summarizeCopies([]))).toBeNull();
  });
});

describe("receiptDate", () => {
  it("keeps a real typed date and falls back to today in New York", () => {
    expect(receiptDate("2026-11-02")).toBe("2026-11-02");
    expect(receiptDate("2026-02-30", new Date("2026-11-14T02:00:00Z"))).toBe("2026-11-13");
    expect(receiptDate("", new Date("2026-11-14T02:00:00Z"))).toBe("2026-11-13");
  });
});
