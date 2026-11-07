import { describe, expect, it } from "vitest";
import { decide, emailBody, fill, parseKind, pickChannel, smsBody, templateReady, withinLimit, type CustomerFacts } from "../campaigns";

const now = new Date("2026-11-06T15:00:00Z");
const base: CustomerFacts = {
  lastCompletedAt: "2025-06-01T12:00:00Z",
  hasOpenJob: false,
  hasActivePlan: false,
  lastCampaignAt: null,
  textable: true,
  email: "a@example.com",
  emailOptedOut: false,
};

describe("decide", () => {
  it("lapsed: sends to a customer last seen over 12 months ago", () => {
    expect(decide("lapsed", base, now)).toEqual({ send: true, channel: "sms" });
  });

  it("lapsed: skips recent customers and customers never served", () => {
    expect(decide("lapsed", { ...base, lastCompletedAt: "2026-02-01T12:00:00Z" }, now)).toMatchObject({ send: false });
    expect(decide("lapsed", { ...base, lastCompletedAt: null }, now)).toMatchObject({ send: false });
  });

  it("tune-up: any customer without a plan or open job, served or not", () => {
    expect(decide("tuneup_spring", { ...base, lastCompletedAt: "2026-10-01T12:00:00Z" }, now)).toMatchObject({ send: true });
    expect(decide("tuneup_fall", { ...base, lastCompletedAt: null }, now)).toMatchObject({ send: true });
  });

  it("skips active plans and open jobs", () => {
    expect(decide("tuneup_fall", { ...base, hasActivePlan: true }, now)).toMatchObject({ send: false });
    expect(decide("lapsed", { ...base, hasOpenJob: true }, now)).toMatchObject({ send: false });
  });

  it("at most one campaign message every 30 days", () => {
    expect(decide("tuneup_fall", { ...base, lastCampaignAt: "2026-10-20T12:00:00Z" }, now)).toMatchObject({ send: false });
    expect(decide("tuneup_fall", { ...base, lastCampaignAt: "2026-10-01T12:00:00Z" }, now)).toMatchObject({ send: true });
  });
});

describe("pickChannel", () => {
  it("text if allowed, else email, else nobody", () => {
    expect(pickChannel({ textable: true, email: "a@b.c", emailOptedOut: false })).toBe("sms");
    expect(pickChannel({ textable: false, email: "a@b.c", emailOptedOut: false })).toBe("email");
    expect(pickChannel({ textable: false, email: "a@b.c", emailOptedOut: true })).toBeNull();
    expect(pickChannel({ textable: false, email: null, emailOptedOut: false })).toBeNull();
  });
});

describe("wording", () => {
  it("needs both the text and the email written", () => {
    expect(templateReady({ sms_text: "Hi", email_subject: "S", email_body: "B" })).toBe(true);
    expect(templateReady({ sms_text: "Hi", email_subject: "", email_body: "B" })).toBe(false);
    expect(templateReady(null)).toBe(false);
  });

  it("fills placeholders and adds the STOP line only when missing", () => {
    expect(fill("Hi {first_name}", "Jane Smith")).toBe("Hi Jane");
    expect(fill("Hi {first_name}", null)).toBe("Hi there");
    expect(smsBody("Time for a tune-up.", "Jane")).toBe("Time for a tune-up. Reply STOP to opt out.");
    expect(smsBody("Text STOP to quit.", "Jane")).toBe("Text STOP to quit.");
  });

  it("every email carries the unsubscribe link and the shop address", () => {
    const body = emailBody("Hello {first_name}", "Jane", "https://x/unsubscribe/abc");
    expect(body).toContain("Hello Jane");
    expect(body).toContain("https://x/unsubscribe/abc");
    expect(body).toContain("Plymouth, MA");
  });

  it("parses only known campaigns", () => {
    expect(parseKind("lapsed")).toBe("lapsed");
    expect(parseKind("all")).toBeNull();
  });
});

describe("withinLimit", () => {
  it("only the first of two simultaneous sends goes through, and unknown counts refuse", () => {
    expect(withinLimit(1)).toBe(true);
    expect(withinLimit(2)).toBe(false);
    expect(withinLimit(null)).toBe(false);
  });
});
