import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../token-crypto";
import { NO_ADDRESS_SECTION, escapeHtml, noteHtml, pageHtml, pageTitle, sectionNameForAddress } from "../onenote-rules";

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
