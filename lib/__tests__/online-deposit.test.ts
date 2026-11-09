import { beforeEach, describe, expect, it, vi } from "vitest";

// recordOnlineDeposit reads and writes documents through the service client.
// The mock keeps one contract row and applies an update only when its filters
// still match the row (the compare and swap the real code relies on).
type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  row: null as Row | null,
  readError: null as { message: string; code?: string } | null,
  writeError: null as { message: string } | null,
  // Changes applied to the row right after a read, to simulate a second delivery racing this one.
  afterRead: null as null | ((row: Row) => void),
  reads: 0,
  writes: [] as Row[],
  notify: vi.fn(),
}));

vi.mock("@/lib/notify-owner", () => ({
  notifyOwnerOfMoney: (...a: unknown[]) => {
    h.notify(...a);
    return Promise.resolve();
  },
  centsToMoney: (c: number) => `$${((c ?? 0) / 100).toFixed(2)}`,
}));
vi.mock("@/lib/tz", () => ({ etDateKey: () => "2026-11-09" }));

function sameArray(a: unknown, literal: string) {
  const list = Array.isArray(a) ? a : [];
  return `{${list.join(",")}}` === literal;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      let values: Row | null = null;
      const filters: unknown[][] = [];
      const b: Record<string, unknown> = {
        select: () => b,
        update: (v: Row) => {
          values = v;
          return b;
        },
        maybeSingle: () => {
          h.reads++;
          const snapshot = h.row ? structuredClone(h.row) : null;
          if (h.afterRead && h.row) {
            h.afterRead(h.row);
            h.afterRead = null;
          }
          return Promise.resolve({ data: snapshot, error: h.readError });
        },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          if (h.writeError) return Promise.resolve({ data: null, error: h.writeError }).then(res, rej);
          const row = h.row;
          const match =
            !!row &&
            filters.every(([op, col, val]) => {
              const cur = row[col as string];
              if (op === "is") return cur == null;
              if (col === "deposit_payment_intent_ids") return sameArray(cur, val as string);
              return cur === val;
            });
          if (match && values) {
            Object.assign(row!, values);
            h.writes.push(values);
          }
          return Promise.resolve({ data: match ? [{ id: row!.id }] : [], error: null }).then(res, rej);
        },
      };
      for (const m of ["eq", "is"]) {
        b[m] = (...args: unknown[]) => {
          filters.push([m, ...args]);
          return b;
        };
      }
      return b;
    },
  },
}));

import { contractDepositCents, DEFAULT_PAYMENT_TERMS, depositForPrice, paymentTermsForPrice } from "@/lib/contract-terms";
import { offeredDepositCents, recordOnlineDeposit } from "@/lib/online-deposit";
import { balanceDueCents } from "@/lib/job-invoice-rules";

const TERMS_9000 = paymentTermsForPrice(9000); // "A deposit of $3,000.00 (one-third) ..."

function contract(over: Row = {}): Row {
  return {
    id: "k1",
    doc_number: "CON-7",
    type: "contract",
    status: "signed",
    total: 9000,
    customer_id: "c1",
    line_items: { paymentTerms: TERMS_9000 },
    deposit_received_cents: null,
    deposit_payment_intent_ids: null,
    customers: { name: "Pat" },
    ...over,
  };
}

const pay = (over: Partial<Parameters<typeof recordOnlineDeposit>[0]> = {}) =>
  recordOnlineDeposit({ documentId: "k1", paymentIntentId: "pi_1", paidCents: 300000, sessionId: "cs_1", ...over });

const alert = () => h.notify.mock.calls.at(-1)?.[0] as { title: string; body: string } | undefined;

beforeEach(() => {
  h.row = contract();
  h.readError = null;
  h.writeError = null;
  h.afterRead = null;
  h.reads = 0;
  h.writes = [];
  h.notify.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("contractDepositCents (amount from the signed terms)", () => {
  it("reads the one-third deposit paymentTermsForPrice wrote", () => {
    expect(contractDepositCents({ total: 9000, paymentTerms: TERMS_9000 })).toBe(300000);
  });

  it("reads the 50% deposit when special-order materials cover it", () => {
    expect(contractDepositCents({ total: 9000, paymentTerms: paymentTermsForPrice(9000, 5000) })).toBe(450000);
  });

  it("matches depositForPrice for an odd price", () => {
    const { deposit } = depositForPrice(1000.01);
    expect(contractDepositCents({ total: 1000.01, paymentTerms: paymentTermsForPrice(1000.01) })).toBe(Math.round(deposit * 100));
  });

  it("uses the amount typed in custom terms", () => {
    expect(contractDepositCents({ total: "12000", paymentTerms: "Deposit of $2,500 due at signing, rest on completion." })).toBe(250000);
  });

  it("stock terms: one-third over $1,000, 50% at or under", () => {
    expect(contractDepositCents({ total: 9000, paymentTerms: DEFAULT_PAYMENT_TERMS })).toBe(300000);
    expect(contractDepositCents({ total: 800, paymentTerms: DEFAULT_PAYMENT_TERMS })).toBe(40000);
  });

  it("gives nothing for custom terms with no amount, no total, or an amount at or above the total", () => {
    expect(contractDepositCents({ total: 9000, paymentTerms: "Half down, rest when done." })).toBeNull();
    expect(contractDepositCents({ total: null, paymentTerms: TERMS_9000 })).toBeNull();
    expect(contractDepositCents({ total: 3000, paymentTerms: TERMS_9000 })).toBeNull();
    expect(contractDepositCents({ total: 9000, paymentTerms: null })).toBeNull();
  });
});

describe("offeredDepositCents (portal Pay deposit button)", () => {
  const doc = (over: Row = {}) => contract(over) as Parameters<typeof offeredDepositCents>[0];

  it("shows on a signed contract with no deposit yet", () => {
    expect(offeredDepositCents(doc(), true)).toBe(300000);
    expect(offeredDepositCents(doc({ deposit_received_cents: 0 }), true)).toBe(300000);
  });

  it("hides before signing, once a deposit is recorded, before SQL 0075, and when terms give no amount", () => {
    expect(offeredDepositCents(doc({ status: "sent" }), true)).toBeNull();
    expect(offeredDepositCents(doc({ status: "draft" }), true)).toBeNull();
    expect(offeredDepositCents(doc({ deposit_received_cents: 300000 }), true)).toBeNull();
    expect(offeredDepositCents(doc(), false)).toBeNull();
    expect(offeredDepositCents(doc({ line_items: { paymentTerms: "Half down." } }), true)).toBeNull();
    expect(offeredDepositCents(doc({ type: "invoice" }), true)).toBeNull();
  });
});

describe("recordOnlineDeposit (webhook)", () => {
  it("records the deposit once, never touches status, and alerts the owner", async () => {
    const res = await pay();
    expect(res).toEqual({ status: "recorded", recordedCents: 300000 });
    expect(h.row).toMatchObject({
      status: "signed",
      deposit_received_cents: 300000,
      deposit_received_at: "2026-11-09",
      deposit_method: "card",
      deposit_payment_intent_ids: ["pi_1"],
    });
    expect(h.writes[0]).not.toHaveProperty("status");
    expect(alert()?.title).toBe("Deposit paid online: $3000.00 on CON-7, Pat");
    expect(alert()?.body).toContain("Balance due at completion $6000.00");
  });

  it("is idempotent on replay", async () => {
    await pay();
    h.notify.mockClear();
    const again = await pay();
    expect(again).toEqual({ status: "replay" });
    expect(h.writes).toHaveLength(1);
    expect(h.row!.deposit_received_cents).toBe(300000);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("does not record a wrong amount, and alerts", async () => {
    const res = await pay({ paidCents: 299999 });
    expect(res).toEqual({ status: "mismatch" });
    expect(h.writes).toHaveLength(0);
    expect(alert()?.title).toContain("does not match");
    expect(alert()?.body).toContain("NOT recorded");
  });

  it("does not record when the terms give no deposit", async () => {
    h.row = contract({ line_items: { paymentTerms: "Half down." } });
    expect((await pay()).status).toBe("mismatch");
    expect(h.writes).toHaveLength(0);
  });

  it("does not record on a document that isn't a contract", async () => {
    h.row = contract({ type: "invoice" });
    expect((await pay()).status).toBe("mismatch");
    expect(h.writes).toHaveLength(0);
    expect(alert()?.title).toContain("not recorded");
  });

  it("adds to a deposit already recorded, never past the total, and warns of a double payment", async () => {
    h.row = contract({ deposit_received_cents: 700000, deposit_payment_intent_ids: ["pi_0"] });
    const res = await pay({ paymentIntentId: "pi_2" });
    expect(res).toEqual({ status: "recorded", recordedCents: 900000 });
    expect(h.row!.deposit_payment_intent_ids).toEqual(["pi_0", "pi_2"]);
    expect(alert()?.body).toContain("may have paid twice");
    expect(alert()?.body).toContain("held to the contract total");
  });

  it("two deliveries of the same payment at once record it once", async () => {
    // Between this delivery's read and write, the other delivery records it.
    h.afterRead = (row) =>
      Object.assign(row, { deposit_received_cents: 300000, deposit_payment_intent_ids: ["pi_1"] });
    const res = await pay();
    expect(res).toEqual({ status: "replay" });
    expect(h.writes).toHaveLength(0);
    expect(h.row!.deposit_received_cents).toBe(300000);
  });

  it("asks Stripe to retry when the database read fails", async () => {
    h.readError = { message: "boom" };
    expect(await pay()).toEqual({ status: "error", error: "boom" });
  });

  it("asks Stripe to retry when the write fails", async () => {
    h.writeError = { message: "nope" };
    expect(await pay()).toEqual({ status: "error", error: "nope" });
  });
});

describe("balance invoice after an online deposit", () => {
  it("Create invoice prefills the contract total less the recorded online deposit", async () => {
    await pay();
    const totalCents = Math.round(Number(h.row!.total) * 100);
    expect(balanceDueCents(totalCents, h.row!.deposit_received_cents as number)).toBe(600000);
  });
});
