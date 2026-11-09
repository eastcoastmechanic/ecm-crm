import { beforeEach, describe, expect, it, vi } from "vitest";

const day = 24 * 60 * 60 * 1000;
const ago = (d: number) => new Date(Date.now() - d * day).toISOString();

const h = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  invoices: [] as Record<string, unknown>[],
  surveys: [] as Record<string, unknown>[],
  claimRows: [{ id: "j1" }] as unknown[],
  smsOk: true,
  canText: true,
  authorized: true,
  sms: vi.fn(),
  updates: [] as { values: Record<string, unknown> }[],
}));

vi.mock("@/lib/cron-auth", () => ({ cronAuthorized: () => h.authorized }));
vi.mock("@/lib/sms", () => ({
  sendSMS: (to: string, body: string) => {
    h.sms(to, body);
    return Promise.resolve(h.smsOk ? { ok: true } : { ok: false, error: "gateway down" });
  },
}));
vi.mock("@/lib/sms-consent", () => ({ canText: () => Promise.resolve(h.canText) }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const rows = () => (table === "jobs" ? h.jobs : table === "documents" ? h.invoices : h.surveys);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.gte = () => chain;
      chain.is = () => chain;
      chain.limit = () => Promise.resolve({ data: rows(), error: null });
      chain.update = (values: Record<string, unknown>) => {
        h.updates.push({ values });
        const u: Record<string, unknown> = {};
        u.eq = () => u;
        u.is = () => u;
        u.select = () => Promise.resolve({ data: values && Object.values(values)[0] === null ? [] : h.claimRows, error: null });
        u.then = (res: (v: unknown) => unknown) => res({ error: null });
        return u;
      };
      // documents and surveys end on .in(...) so make the chain itself awaitable there.
      chain.then = (res: (v: unknown) => unknown) => res({ data: rows(), error: null });
      return chain;
    },
  },
}));

import { GET } from "@/app/api/cron/review-requests/route";

const customer = { name: "Dana Smith", phone: "5085550101", sms_consent: true };
const job = (over: Record<string, unknown> = {}) => ({
  id: "j1",
  completed_at: ago(3),
  review_request_sent_at: null,
  review_reminder_sent_at: null,
  customers: customer,
  ...over,
});

async function run() {
  return (await GET(new Request("http://x/api/cron/review-requests"))).json();
}

beforeEach(() => {
  h.jobs = [job()];
  h.invoices = [{ job_id: "j1", status: "paid", paid_at: ago(2) }];
  h.surveys = [];
  h.claimRows = [{ id: "j1" }];
  h.smsOk = true;
  h.canText = true;
  h.authorized = true;
  h.sms.mockClear();
  h.updates = [];
});

describe("review-requests cron", () => {
  it("rejects an unauthorized caller", async () => {
    h.authorized = false;
    const res = await GET(new Request("http://x"));
    expect(res.status).toBe(401);
    expect(h.sms).not.toHaveBeenCalled();
  });

  it("texts a consented customer the survey link after payment", async () => {
    const out = await run();
    expect(out.sent).toBe(1);
    expect(h.sms).toHaveBeenCalledTimes(1);
    const [to, body] = h.sms.mock.calls[0];
    expect(to).toBe("5085550101");
    expect(body).toContain("/survey/j1");
    expect(body).toContain("Hi Dana,");
  });

  it("does not text a customer without sms_consent", async () => {
    h.jobs = [job({ customers: { ...customer, sms_consent: false } })];
    const out = await run();
    expect(out.sent).toBe(0);
    expect(out.skipped).toBe(1);
    expect(h.sms).not.toHaveBeenCalled();
  });

  it("does not text a customer who opted out of follow-ups, and does not stamp the job", async () => {
    h.jobs = [job({ customers: { ...customer, no_followups: true } })];
    const out = await run();
    expect(out.sent).toBe(0);
    expect(out.skipped).toBe(1);
    expect(h.sms).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("does not text when the customer row comes back as an array and follow-ups are off", async () => {
    h.jobs = [job({ customers: [{ ...customer, no_followups: true }] })];
    const out = await run();
    expect(out.sent).toBe(0);
    expect(out.skipped).toBe(1);
    expect(h.sms).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("does not send the reminder when follow-ups are off for that customer", async () => {
    h.jobs = [job({ review_request_sent_at: ago(5.2), customers: { ...customer, no_followups: true } })];
    const out = await run();
    expect(out.sent).toBe(0);
    expect(h.sms).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("still texts when the follow-up flag is off", async () => {
    h.jobs = [job({ customers: { ...customer, no_followups: false } })];
    expect((await run()).sent).toBe(1);
    expect(h.sms).toHaveBeenCalledTimes(1);
  });

  it("does not text a number that is opted out", async () => {
    h.canText = false;
    expect((await run()).sent).toBe(0);
    expect(h.sms).not.toHaveBeenCalled();
  });

  it("waits while the invoice is unpaid", async () => {
    h.invoices = [{ job_id: "j1", status: "sent", paid_at: null }];
    expect((await run()).sent).toBe(0);
    expect(h.sms).not.toHaveBeenCalled();
  });

  it("does not text a customer who already got the survey email", async () => {
    h.jobs = [job({ follow_up_sent_at: ago(1) })];
    expect((await run()).sent).toBe(0);
    expect(h.sms).not.toHaveBeenCalled();
  });

  it("does not text once they answered the survey", async () => {
    h.surveys = [{ job_id: "j1" }];
    expect((await run()).sent).toBe(0);
    expect(h.sms).not.toHaveBeenCalled();
  });

  it("sends the reminder five days after the ask", async () => {
    h.jobs = [job({ review_request_sent_at: ago(5.2) })];
    const out = await run();
    expect(out.sent).toBe(1);
    expect(h.sms.mock.calls[0][1]).toMatch(/reminder/i);
  });

  it("does nothing when another run already claimed the text", async () => {
    h.claimRows = [];
    const out = await run();
    expect(out.sent).toBe(0);
    expect(h.sms).not.toHaveBeenCalled();
  });

  it("reports a failed send and releases the claim so tomorrow retries", async () => {
    h.smsOk = false;
    const out = await run();
    expect(out.sent).toBe(0);
    expect(out.errors[0]).toMatch(/gateway down/);
    const released = h.updates.some((u) => u.values.review_request_sent_at === null);
    expect(released).toBe(true);
  });
});
