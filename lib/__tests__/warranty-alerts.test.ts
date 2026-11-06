import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  selectResult: { data: [] as unknown[], error: null as null | { message: string } },
  updates: [] as { table: string; patch: Record<string, unknown>; id?: unknown }[],
  send: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      let mode: "select" | "update" = "select";
      let patch: Record<string, unknown> = {};
      let id: unknown;
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "not", "gte", "lte", "is"]) {
        builder[m] = (...args: unknown[]) => {
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
          h.updates.push({ table, patch, id });
          resolve({ error: null });
        } else {
          resolve(h.selectResult);
        }
      };
      return builder;
    },
  },
}));
vi.mock("@/lib/resend", () => ({
  resend: { emails: { send: h.send } },
  RESEND_FROM_EMAIL: "office@example.test",
  RESEND_REPLY_TO: "reply@example.test",
}));

import { sendWarrantyAlerts } from "../warranty-alerts";

const item = (properties: unknown, over: Record<string, unknown> = {}) => ({
  id: "eq1",
  type: "Heat pump",
  brand: "Mitsubishi",
  model: "MXZ",
  warranty_expiration: "2026-12-15",
  properties,
  ...over,
});
const customer = { name: "Pat", email: "pat@example.test" };

beforeEach(() => {
  h.selectResult = { data: [], error: null };
  h.updates = [];
  h.send.mockReset();
  h.send.mockResolvedValue({ error: null });
});

describe("sendWarrantyAlerts", () => {
  it("emails the customer when equipment's property and customer come back as objects", async () => {
    h.selectResult.data = [item({ address: "12 Elm St", customers: customer })];

    const out = await sendWarrantyAlerts();

    expect(out).toEqual({ sent: 1, errors: [] });
    const mail = h.send.mock.calls[0][0];
    expect(mail.to).toBe("pat@example.test");
    expect(mail.text).toContain("Hi Pat");
    expect(mail.text).toContain("Mitsubishi MXZ Heat pump at 12 Elm St");
    expect(mail.text).toContain("2026-12-15");
    expect(h.updates).toEqual([
      { table: "equipment", id: "eq1", patch: { warranty_alert_sent_at: expect.any(String) } },
    ]);
  });

  it("still works if Supabase hands back one-item lists", async () => {
    h.selectResult.data = [item([{ address: "12 Elm St", customers: [customer] }])];
    expect((await sendWarrantyAlerts()).sent).toBe(1);
  });

  it("skips equipment whose customer has no email", async () => {
    h.selectResult.data = [item({ address: "12 Elm St", customers: { name: "Pat", email: null } })];
    expect(await sendWarrantyAlerts()).toEqual({ sent: 0, errors: [] });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("does not mark the alert sent when the email fails", async () => {
    h.selectResult.data = [item({ address: "12 Elm St", customers: customer })];
    h.send.mockResolvedValue({ error: { message: "mailbox full" } });

    const out = await sendWarrantyAlerts();

    expect(out).toEqual({ sent: 0, errors: ["equipment eq1: mailbox full"] });
    expect(h.updates).toEqual([]);
  });

  it("reports a failed read", async () => {
    h.selectResult = { data: [], error: { message: "read failed" } };
    expect(await sendWarrantyAlerts()).toEqual({ sent: 0, errors: ["read failed"] });
  });
});
