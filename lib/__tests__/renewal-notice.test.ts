import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  selectResult: { data: [] as unknown[], error: null as null | { message: string } },
  calls: [] as { method: string; args: unknown[] }[],
  updates: [] as { patch: Record<string, unknown>; id?: unknown }[],
  emails: [] as { to: string; subject: string; text: string }[],
  emailError: null as null | { message: string },
  texts: [] as { to: string; body: string }[],
  canText: true,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      let mode: "select" | "update" = "select";
      let patch: Record<string, unknown> = {};
      let id: unknown;
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "lte", "is"]) {
        builder[m] = (...args: unknown[]) => {
          h.calls.push({ method: m, args });
          if (m === "eq" && args[0] === "id") id = args[1];
          return builder;
        };
      }
      builder.update = (p: Record<string, unknown>) => {
        mode = "update";
        patch = p;
        return builder;
      };
      builder.then = (resolve: (v: unknown) => void) => {
        if (mode === "update") {
          h.updates.push({ patch, id });
          resolve({ error: null });
        } else resolve(h.selectResult);
      };
      return builder;
    },
  },
}));
vi.mock("@/lib/resend", () => ({
  resend: {
    emails: {
      send: (m: { to: string; subject: string; text: string }) => {
        h.emails.push(m);
        return Promise.resolve({ error: h.emailError });
      },
    },
  },
  RESEND_FROM_EMAIL: "from@example.test",
  RESEND_REPLY_TO: "reply@example.test",
}));
vi.mock("@/lib/sms", () => ({
  sendSMS: (to: string, body: string) => {
    h.texts.push({ to, body });
    return Promise.resolve({ ok: true });
  },
}));
vi.mock("@/lib/sms-consent", () => ({ canText: () => Promise.resolve(h.canText) }));

import {
  noticeCoversTerm,
  renewalChargeDate,
  renewalChargeGate,
  renewalNoticeCopy,
  sendContractRenewalNotices,
} from "../renewal-notice";

beforeEach(() => {
  h.selectResult = { data: [], error: null };
  h.calls = [];
  h.updates = [];
  h.emails = [];
  h.emailError = null;
  h.texts = [];
  h.canText = true;
});

describe("noticeCoversTerm", () => {
  it("counts a notice sent in this term's 30-day window", () => {
    expect(noticeCoversTerm("2026-10-11T13:00:00Z", "2026-11-10")).toBe(true);
  });
  it("does not count last year's notice once the plan rolled a year", () => {
    expect(noticeCoversTerm("2025-10-11T13:00:00Z", "2026-11-10")).toBe(false);
  });
  it("uses the New York date: 1 AM UTC on Oct 11 is still Oct 10 in New York", () => {
    expect(noticeCoversTerm("2026-10-11T01:00:00Z", "2026-11-10")).toBe(false);
    expect(noticeCoversTerm("2026-10-11T05:00:00Z", "2026-11-10")).toBe(true);
  });
  it("is false with no stamp", () => {
    expect(noticeCoversTerm(null, "2026-11-10")).toBe(false);
  });
});

describe("renewalChargeDate / renewalChargeGate", () => {
  it("charges the week before the end when the notice went out early", () => {
    expect(renewalChargeDate("2026-11-10", "2026-10-11")).toBe("2026-11-03");
  });
  it("waits 7 days after a late notice", () => {
    expect(renewalChargeDate("2026-11-10", "2026-11-01")).toBe("2026-11-08");
  });
  it("no notice means no charge", () => {
    expect(renewalChargeGate({ reminderSentAt: null, endDate: "2026-11-10", now: new Date("2026-11-03T15:00:00Z") })).toEqual({
      charge: false,
      reason: "no_notice",
      chargeDate: null,
    });
  });
  it("a notice at least 7 days old allows the charge", () => {
    expect(
      renewalChargeGate({ reminderSentAt: "2026-10-27T13:00:00Z", endDate: "2026-11-10", now: new Date("2026-11-03T15:00:00Z") })
    ).toEqual({ charge: true });
  });
  it("a notice 6 days old does not", () => {
    expect(
      renewalChargeGate({ reminderSentAt: "2026-10-28T13:00:00Z", endDate: "2026-11-10", now: new Date("2026-11-03T15:00:00Z") })
    ).toEqual({ charge: false, reason: "notice_too_recent", chargeDate: "2026-11-04" });
  });
});

describe("renewalNoticeCopy", () => {
  it("says the plan, renewal date, exact amount, that the card on file is charged and when, and how to cancel", () => {
    const c = renewalNoticeCopy({
      customerName: "Pat",
      planName: "Annual Maintenance Plan",
      endDate: "2026-11-10",
      priceCents: 29900,
      chargeDate: "2026-11-03",
    });
    expect(c.subject).toBe("Your Annual Maintenance Plan renews on November 10, 2026");
    expect(c.email).toContain("Hi Pat,");
    expect(c.email).toContain("renews on November 10, 2026");
    expect(c.email).toContain("On November 3, 2026 we will charge $299.00 to the card on file");
    expect(c.email).toContain("reply to this email or call us at (774) 343-6369 before November 3, 2026");
    expect(c.text).toContain("$299.00");
    expect(c.text).toContain("November 3, 2026");
    expect(c.text).toContain("(774) 343-6369");
    expect(c.text).toContain("Reply STOP");
  });
  it("promises no charge when the plan is not set to renew automatically", () => {
    const c = renewalNoticeCopy({ customerName: null, planName: null, endDate: "2026-11-10", priceCents: null, chargeDate: null });
    expect(c.email).toContain("Hi,");
    expect(c.email).toContain("maintenance plan");
    expect(c.email).not.toMatch(/we will charge/);
    expect(c.email).toContain("We will not charge your card");
    expect(c.email).toContain("(774) 343-6369");
  });
});

const customer = { name: "Pat", email: "pat@example.test", phone: "5085550100", sms_consent: true };
const row = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  plan_name: "Annual Maintenance Plan",
  end_date: "2026-11-10",
  renewal_price_cents: 29900,
  auto_renew_authorized_at: "2025-11-10T15:00:00Z",
  renewal_reminder_sent_at: null,
  customers: customer,
  ...over,
});
const NOW = new Date("2026-10-11T13:00:00Z");

describe("sendContractRenewalNotices", () => {
  it("emails the notice with amount and charge date, stamps it, and texts when allowed", async () => {
    h.selectResult.data = [row()];
    const out = await sendContractRenewalNotices(NOW);
    expect(out).toEqual({ sent: 1, texted: 1, noEmail: 0, errors: [] });
    expect(h.emails[0].to).toBe("pat@example.test");
    expect(h.emails[0].text).toContain("$299.00");
    expect(h.emails[0].text).toContain("On November 3, 2026 we will charge");
    expect(h.updates).toEqual([{ id: "c1", patch: { renewal_reminder_sent_at: NOW.toISOString() } }]);
    expect(h.texts[0].body).toContain("$299.00");
  });

  it("no longer filters on a null stamp, so a new term gets a new notice", async () => {
    await sendContractRenewalNotices(NOW);
    expect(h.calls.some((c) => c.method === "is")).toBe(false);
  });

  it("sends again next year: last year's stamp does not count for the new end date", async () => {
    h.selectResult.data = [row({ end_date: "2026-11-10", renewal_reminder_sent_at: "2025-10-11T13:00:00Z" })];
    expect((await sendContractRenewalNotices(NOW)).sent).toBe(1);
  });

  it("skips a term already noticed", async () => {
    h.selectResult.data = [row({ renewal_reminder_sent_at: "2026-10-11T13:00:00Z" })];
    expect((await sendContractRenewalNotices(new Date("2026-10-12T13:00:00Z"))).sent).toBe(0);
    expect(h.emails).toEqual([]);
  });

  it("does not stamp, or text, when there is no email", async () => {
    h.selectResult.data = [row({ customers: { ...customer, email: null } })];
    const out = await sendContractRenewalNotices(NOW);
    expect(out).toEqual({ sent: 0, texted: 0, noEmail: 1, errors: [] });
    expect(h.updates).toEqual([]);
    expect(h.texts).toEqual([]);
  });

  it("does not stamp when the email fails", async () => {
    h.selectResult.data = [row()];
    h.emailError = { message: "bounced" };
    const out = await sendContractRenewalNotices(NOW);
    expect(out.errors).toEqual(["contract c1: bounced"]);
    expect(h.updates).toEqual([]);
  });

  it("does not text without consent or when the number opted out", async () => {
    h.selectResult.data = [row({ customers: { ...customer, sms_consent: false } })];
    await sendContractRenewalNotices(NOW);
    h.canText = false;
    h.selectResult.data = [row()];
    await sendContractRenewalNotices(NOW);
    expect(h.emails).toHaveLength(2);
    expect(h.texts).toEqual([]);
  });

  it("does not promise a charge on a plan without auto-renew", async () => {
    h.selectResult.data = [row({ auto_renew_authorized_at: null })];
    await sendContractRenewalNotices(NOW);
    expect(h.emails[0].text).toContain("We will not charge your card");
  });

  it("does not promise a charge when the notice is too late to give a week before the end", async () => {
    h.selectResult.data = [row()];
    await sendContractRenewalNotices(new Date("2026-11-05T13:00:00Z"));
    expect(h.emails[0].text).not.toMatch(/we will charge/);
  });
});
