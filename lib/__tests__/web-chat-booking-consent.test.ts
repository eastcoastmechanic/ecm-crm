import { beforeEach, describe, expect, it, vi } from "vitest";

// Website chat booking follows the same rule as /book (#174): saying "text me"
// never sets sms_consent on its own, because anyone can type anyone's number.

const h = vi.hoisted(() => ({
  intake: vi.fn(),
  jobInsert: vi.fn(),
  ownerAlert: vi.fn(),
  startOptIn: vi.fn(),
  optInState: "none" as string,
  optInStateError: null as Error | null,
  startOptInResult: "sent" as string,
  startOptInError: null as Error | null,
  textCapAllows: true,
}));

vi.mock("@/lib/customer-intake", () => ({
  resolveCustomerPropertyEquipment: (input: unknown) => {
    h.intake(input);
    return Promise.resolve({ customerId: "c1", propertyId: "p1", equipmentId: null });
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      insert: (row: unknown) => {
        h.jobInsert(row);
        return { select: () => ({ single: () => Promise.resolve({ data: { id: "job-1" }, error: null }) }) };
      },
    }),
  },
}));

vi.mock("@/lib/notify-owner", () => ({
  notifyOwnerOfWebLead: (input: unknown) => {
    h.ownerAlert(input);
    return Promise.resolve();
  },
}));

vi.mock("../receptionist/tools", () => ({ checkAvailabilityTool: { name: "check_availability" } }));

vi.mock("@/lib/sms-consent", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/sms-consent")>();
  return {
    ...real,
    smsOptInState: () => (h.optInStateError ? Promise.reject(h.optInStateError) : Promise.resolve(h.optInState)),
    startDoubleOptIn: (phone: string, name: string | null) => {
      h.startOptIn(phone, name);
      return h.startOptInError ? Promise.reject(h.startOptInError) : Promise.resolve(h.startOptInResult);
    },
  };
});

vi.mock("@/lib/rate-limit-db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rate-limit-db")>();
  return { ...real, allowAll: () => Promise.resolve(h.textCapAllows) };
});

import { buildWebChatTools } from "../receptionist/web-tools";

type Tool = { name: string; run: (args: Record<string, unknown>) => Promise<unknown> };
const booking = () =>
  (buildWebChatTools() as unknown as Tool[]).find((t) => t.name === "create_web_booking_request")!;

const args = (extra: Record<string, unknown> = {}) => ({
  name: "Test Person",
  phone: "508-555-0100",
  address: "1 Test St",
  date: "2099-06-15",
  time: "10:00",
  description: "AC not cooling",
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.optInState = "none";
  h.optInStateError = null;
  h.startOptInResult = "sent";
  h.startOptInError = null;
  h.textCapAllows = true;
});

describe("website chat booking and texts", () => {
  it("visitor says yes to texts: customer saved without consent, Reply YES text started, booking goes through", async () => {
    const reply = String(await booking().run(args({ smsConsent: true })));
    expect(h.intake).toHaveBeenCalledWith(expect.objectContaining({ smsConsent: false }));
    expect(h.startOptIn).toHaveBeenCalledWith("508-555-0100", "Test Person");
    expect(h.jobInsert).toHaveBeenCalledTimes(1);
    expect(h.ownerAlert).toHaveBeenCalledTimes(1);
    expect(reply).toMatch(/pending confirmation/);
    expect(reply).toMatch(/reply YES/);
  });

  it("not asked or declined: no consent, no text", async () => {
    await booking().run(args());
    await booking().run(args({ smsConsent: false }));
    for (const call of h.intake.mock.calls) expect(call[0]).toMatchObject({ smsConsent: false });
    expect(h.startOptIn).not.toHaveBeenCalled();
  });

  it("number already opted in: consent kept, no second text", async () => {
    h.optInState = "opted_in";
    const reply = String(await booking().run(args({ smsConsent: true })));
    expect(h.intake).toHaveBeenCalledWith(expect.objectContaining({ smsConsent: true }));
    expect(h.startOptIn).not.toHaveBeenCalled();
    expect(reply).not.toMatch(/reply YES/);
  });

  it("number that sent STOP: no consent, no text", async () => {
    h.optInState = "opted_out";
    await booking().run(args({ smsConsent: true }));
    expect(h.intake).toHaveBeenCalledWith(expect.objectContaining({ smsConsent: false }));
    expect(h.startOptIn).not.toHaveBeenCalled();
  });

  it("can't read opt-in state: no consent, no text, booking still saved", async () => {
    h.optInStateError = new Error("db down");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await booking().run(args({ smsConsent: true }));
    expect(h.intake).toHaveBeenCalledWith(expect.objectContaining({ smsConsent: false }));
    expect(h.startOptIn).not.toHaveBeenCalled();
    expect(h.jobInsert).toHaveBeenCalledTimes(1);
  });

  it("hourly cap on confirmation texts reached: booking saved, no text", async () => {
    h.textCapAllows = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = String(await booking().run(args({ smsConsent: true })));
    expect(h.startOptIn).not.toHaveBeenCalled();
    expect(h.jobInsert).toHaveBeenCalledTimes(1);
    expect(reply).toMatch(/pending confirmation/);
    expect(reply).not.toMatch(/reply YES/);
  });

  it("the Reply YES text failing does not fail the booking", async () => {
    h.startOptInError = new Error("gateway down");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = String(await booking().run(args({ smsConsent: true })));
    expect(reply).toMatch(/pending confirmation/);
    expect(reply).not.toMatch(/reply YES/);
    expect(h.ownerAlert).toHaveBeenCalledTimes(1);
  });
});
