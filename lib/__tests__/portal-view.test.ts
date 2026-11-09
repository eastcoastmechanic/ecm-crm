import { describe, expect, it } from "vitest";
import {
  formatPortalDate,
  formatPortalDateTime,
  isSignatureImage,
  portalContractTerms,
  portalJobNote,
  portalPmReport,
  portalPricedLines,
  portalStatusLabel,
  REQUEST_NOTE_MAX,
  SIGNATURE_MAX_LENGTH,
  validateServiceRequest,
} from "../portal-view";
import { toEtLocalInput } from "../tz";

describe("portalPricedLines", () => {
  const stored = {
    items: [
      {
        category: "Equipment",
        description: "Heat pump",
        price_book_item_name: "HP-36",
        qty: 1,
        unit: "ea",
        good: 5000,
        better: 6500,
        best: 8000,
        notes: "office note",
        cost: 3100.5,
      },
    ],
    brand: { good: "A", better: "B", best: "C" },
    mass_save_eligible: true,
    mass_save_note: "Rebate up to $X",
    totals: { good: 5000, better: 6500, best: 8000 },
    pricing_mode: "tiered",
    option_label: "internal",
  };

  it("drops cost, price book name, line notes and unknown keys", () => {
    const view = portalPricedLines(stored);
    expect(view.items).toEqual([
      { category: "Equipment", description: "Heat pump", qty: 1, unit: "ea", good: 5000, better: 6500, best: 8000 },
    ]);
    expect(JSON.stringify(view)).not.toContain("3100.5");
    expect(JSON.stringify(view)).not.toContain("HP-36");
    expect(JSON.stringify(view)).not.toContain("office note");
    expect(view).not.toHaveProperty("option_label");
  });

  it("keeps what the customer sees", () => {
    const view = portalPricedLines(stored);
    expect(view.totals).toEqual({ good: 5000, better: 6500, best: 8000 });
    expect(view.brand).toEqual({ good: "A", better: "B", best: "C" });
    expect(view.mass_save_eligible).toBe(true);
    expect(view.mass_save_note).toBe("Rebate up to $X");
    expect(view.pricing_mode).toBe("tiered");
  });

  it("keeps a missing tier price as null, and copes with an empty or odd row", () => {
    const view = portalPricedLines({ items: [{ description: "Labor", qty: "2", good: null, better: 250, best: undefined }] });
    expect(view.items[0]).toMatchObject({ qty: 2, good: null, better: 250, best: null });
    expect(portalPricedLines(null)).toMatchObject({ items: [], totals: { good: 0, better: 0, best: 0 } });
    expect(portalPricedLines({ pricing_mode: "weird" })).not.toHaveProperty("pricing_mode");
  });
});

describe("portalContractTerms", () => {
  it("keeps the signed terms and drops office notes and the source estimate id", () => {
    const terms = portalContractTerms({
      scopeOfWork: "Install",
      paymentTerms: "50/50",
      warrantyTerms: "10 years",
      startDate: "2026-11-12",
      estimatedCompletion: null,
      notes: "internal",
      fromDocumentId: "abc",
      autoRenewPriceCents: 29900,
      visitMonths: [4, 10],
      autoRenewAuthorizedAt: null,
    });
    expect(terms).toEqual({
      scopeOfWork: "Install",
      paymentTerms: "50/50",
      warrantyTerms: "10 years",
      startDate: "2026-11-12",
      estimatedCompletion: null,
      autoRenewPriceCents: 29900,
      autoRenewAuthorizedAt: null,
    });
  });
});

describe("portalPmReport", () => {
  it("keeps counts, failed items and recommendations only", () => {
    const report = portalPmReport({
      summary: { pass: 10, fail: 1, na: 2 },
      failures: [{ key: "k1", section: "Coil", label: "Dirty", notes: "Clean next visit", photo_path: "x" }],
      recommendations: "Replace filter",
      tech_name: "someone",
    });
    expect(report).toEqual({
      summary: { pass: 10, fail: 1, na: 2 },
      failures: [{ key: "k1", section: "Coil", label: "Dirty", notes: "Clean next visit" }],
      recommendations: "Replace filter",
    });
    expect(portalPmReport(null)).toEqual({ summary: null, failures: [], recommendations: null });
  });
});

describe("portalJobNote", () => {
  it("shows the customer's words on a request", () => {
    expect(portalJobNote("requested", "AC blowing warm air")).toBe("AC blowing warm air");
  });

  it("stops at the first Field Board line", () => {
    const notes = "AC blowing warm air\n[Field Board 2026-11-08T12:00:00Z] On my way · gate code 1234\ncustomer was rude";
    expect(portalJobNote("requested", notes)).toBe("AC blowing warm air");
    expect(portalJobNote("requested", "[Field Board 2026-11-08] note")).toBeNull();
  });

  it("hides notes once the job is past the request stage", () => {
    expect(portalJobNote("scheduled", "Install per contract")).toBeNull();
    expect(portalJobNote("in_progress", "x")).toBeNull();
    expect(portalJobNote("complete", "x")).toBeNull();
    expect(portalJobNote("requested", null)).toBeNull();
    expect(portalJobNote("requested", "  ")).toBeNull();
  });
});

describe("portalStatusLabel", () => {
  it("never shows a raw status", () => {
    expect(portalStatusLabel("in_progress")).toBe("In progress");
    expect(portalStatusLabel("completed")).toBe("Complete");
    expect(portalStatusLabel("complete")).toBe("Complete");
    expect(portalStatusLabel("requested")).toBe("Requested");
    expect(portalStatusLabel("on_hold")).toBe("On hold");
    expect(portalStatusLabel(null)).toBe("");
  });
});

describe("formatPortalDate", () => {
  it("shows a calendar date as that date, whatever the server zone", () => {
    expect(formatPortalDate("2026-04-01")).toBe("4/1/2026");
    expect(formatPortalDate("2026-04-01", "long")).toBe("April 1, 2026");
  });

  it("shows a timestamp as its New York date", () => {
    // 01:30 UTC on Nov 7 is 8:30 PM on Nov 6 in New York.
    expect(formatPortalDate("2026-11-07T01:30:00.000Z")).toBe("11/6/2026");
    expect(formatPortalDate("2026-11-07T01:30:00.000Z", "long")).toBe("November 6, 2026");
  });

  it("returns null for empty or unreadable values", () => {
    expect(formatPortalDate(null)).toBeNull();
    expect(formatPortalDate("")).toBeNull();
    expect(formatPortalDate("not a date")).toBeNull();
  });
});

describe("formatPortalDateTime", () => {
  it("shows New York date and time", () => {
    expect(formatPortalDateTime("2026-11-07T01:30:00.000Z")).toBe("11/6/2026, 8:30 PM");
    expect(formatPortalDateTime(null)).toBeNull();
  });
});

describe("isSignatureImage", () => {
  it("accepts a canvas PNG data URL", () => {
    expect(isSignatureImage("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isSignatureImage("")).toBe(false);
    expect(isSignatureImage(null)).toBe(false);
    expect(isSignatureImage("javascript:alert(1)")).toBe(false);
    expect(isSignatureImage("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isSignatureImage('data:image/png;base64,abc" onerror="x')).toBe(false);
    expect(isSignatureImage(`data:image/png;base64,${"A".repeat(SIGNATURE_MAX_LENGTH)}`)).toBe(false);
  });
});

describe("validateServiceRequest", () => {
  const ctx = { today: "2026-11-09", propertyIds: ["p1", "p2"] };
  const good = { propertyId: "p1", date: "2026-11-10", window: "afternoon", notes: "  No heat  " };

  it("accepts a request for one of the customer's properties and sets a New York time", () => {
    const result = validateServiceRequest(good, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.propertyId).toBe("p1");
    expect(result.notes).toBe("No heat");
    expect(toEtLocalInput(result.scheduledAt)).toBe("2026-11-10T12:00");
  });

  it("refuses a property that isn't the customer's", () => {
    const result = validateServiceRequest({ ...good, propertyId: "someone-elses" }, ctx);
    expect(result).toMatchObject({ ok: false });
  });

  it("needs a property, a description, a window and a date", () => {
    expect(validateServiceRequest({ ...good, propertyId: "" }, ctx)).toEqual({ ok: false, error: "Please pick the property." });
    expect(validateServiceRequest({ ...good, notes: "   " }, ctx)).toEqual({
      ok: false,
      error: "Please tell us what you need service for.",
    });
    expect(validateServiceRequest({ ...good, window: "midnight" }, ctx)).toEqual({ ok: false, error: "Please pick a preferred window." });
    expect(validateServiceRequest({ ...good, date: "" }, ctx)).toEqual({ ok: false, error: "Please pick a preferred date." });
  });

  it("refuses a description that is too long", () => {
    expect(validateServiceRequest({ ...good, notes: "x".repeat(REQUEST_NOTE_MAX + 1) }, ctx)).toMatchObject({ ok: false });
    expect(validateServiceRequest({ ...good, notes: "x".repeat(REQUEST_NOTE_MAX) }, ctx)).toMatchObject({ ok: true });
  });

  it("refuses a past day and a day more than a year out, allows today", () => {
    expect(validateServiceRequest({ ...good, date: "2026-11-08" }, ctx)).toMatchObject({ ok: false });
    expect(validateServiceRequest({ ...good, date: "2026-11-09" }, ctx)).toMatchObject({ ok: true });
    expect(validateServiceRequest({ ...good, date: "2027-11-09" }, ctx)).toMatchObject({ ok: true });
    expect(validateServiceRequest({ ...good, date: "2027-11-10" }, ctx)).toMatchObject({ ok: false });
  });
});
