import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  intake: vi.fn(),
  jobInsert: vi.fn(),
  ownerAlert: vi.fn(),
  startOptIn: vi.fn(),
  optInState: "none" as string,
  optInStateError: null as Error | null,
  startOptInResult: "sent" as string,
  startOptInError: null as Error | null,
  redirected: null as string | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.redirected = url;
    throw new Error("NEXT_REDIRECT");
  },
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
        return Promise.resolve({ error: null });
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

import { bookService } from "@/app/(marketing)/book/actions";
import { bookingConsentPlan } from "@/lib/sms-consent";

function form(extra: Record<string, string> = {}) {
  const f = new FormData();
  const fields: Record<string, string> = {
    name: "Test Person",
    phone: "508-555-0100",
    address: "1 Test St",
    service_type: "AC repair",
    date: "2099-06-15",
    window: "morning",
    ...extra,
  };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function book(f: FormData) {
  try {
    return await bookService(null, f);
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") return "redirected";
    throw err;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  h.optInState = "none";
  h.optInStateError = null;
  h.startOptInResult = "sent";
  h.startOptInError = null;
  h.redirected = null;
});

describe("bookingConsentPlan", () => {
  it("box not ticked: no consent, no text", () => {
    for (const s of ["none", "pending", "opted_in", "opted_out"] as const) {
      expect(bookingConsentPlan(false, s)).toEqual({ consentNow: false, askToConfirm: false });
    }
  });

  it("box ticked on a new number: no consent yet, send the Reply YES text", () => {
    expect(bookingConsentPlan(true, "none")).toEqual({ consentNow: false, askToConfirm: true });
    expect(bookingConsentPlan(true, "pending")).toEqual({ consentNow: false, askToConfirm: true });
  });

  it("number already confirmed (YES or START on file): consent, no extra text", () => {
    expect(bookingConsentPlan(true, "opted_in")).toEqual({ consentNow: true, askToConfirm: false });
  });

  it("number that sent STOP: nothing", () => {
    expect(bookingConsentPlan(true, "opted_out")).toEqual({ consentNow: false, askToConfirm: false });
  });
});

describe("website booking with the text box", () => {
  it("ticked: customer saved without consent, Reply YES text started, booking and owner alert go through", async () => {
    expect(await book(form({ sms_consent: "on" }))).toBe("redirected");
    expect(h.intake).toHaveBeenCalledWith(expect.objectContaining({ smsConsent: false }));
    expect(h.startOptIn).toHaveBeenCalledWith("508-555-0100", "Test Person");
    expect(h.jobInsert).toHaveBeenCalledTimes(1);
    expect(h.ownerAlert).toHaveBeenCalledTimes(1);
    expect(h.redirected).toBe("/book?success=1");
  });

  it("not ticked: no consent and no text", async () => {
    expect(await book(form())).toBe("redirected");
    expect(h.intake).toHaveBeenCalledWith(expect.objectContaining({ smsConsent: false }));
    expect(h.startOptIn).not.toHaveBeenCalled();
  });

  it("ticked for a number already opted in: consent kept, no second text", async () => {
    h.optInState = "opted_in";
    await book(form({ sms_consent: "on" }));
    expect(h.intake).toHaveBeenCalledWith(expect.objectContaining({ smsConsent: true }));
    expect(h.startOptIn).not.toHaveBeenCalled();
  });

  it("ticked for a number that sent STOP: no consent, no text", async () => {
    h.optInState = "opted_out";
    await book(form({ sms_consent: "on" }));
    expect(h.intake).toHaveBeenCalledWith(expect.objectContaining({ smsConsent: false }));
    expect(h.startOptIn).not.toHaveBeenCalled();
  });

  it("can't read opt-in state: no consent, no text, booking still saved", async () => {
    h.optInStateError = new Error("db down");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await book(form({ sms_consent: "on" }))).toBe("redirected");
    expect(h.intake).toHaveBeenCalledWith(expect.objectContaining({ smsConsent: false }));
    expect(h.startOptIn).not.toHaveBeenCalled();
    expect(h.jobInsert).toHaveBeenCalledTimes(1);
  });

  it("the Reply YES text failing does not fail the booking", async () => {
    h.startOptInError = new Error("gateway down");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await book(form({ sms_consent: "on" }))).toBe("redirected");
    expect(h.ownerAlert).toHaveBeenCalledTimes(1);
    expect(h.redirected).toBe("/book?success=1");
  });
});
