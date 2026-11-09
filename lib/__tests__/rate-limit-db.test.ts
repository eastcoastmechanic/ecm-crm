import { beforeEach, describe, expect, it, vi } from "vitest";

type RpcReply = { data: unknown; error: { code?: string; message: string } | null };

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  // Keys the fake database says are over their limit.
  blocked: (() => false) as (key: string) => boolean,
  rpcReply: null as null | ((key: string) => RpcReply | Promise<RpcReply>),
  startOptIn: vi.fn(),
  intake: vi.fn(),
  ownerAlert: vi.fn(),
  emailSend: vi.fn(),
  webChat: vi.fn(),
  redirected: null as string | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.redirected = url;
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" })),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (name: string, args: { p_key: string; p_limit: number; p_window_seconds: number }) => {
      h.rpc(name, args);
      if (h.rpcReply) return Promise.resolve(h.rpcReply(args.p_key));
      return Promise.resolve({ data: !h.blocked(args.p_key), error: null });
    },
    from: (table: string) => {
      h.from(table);
      // Awaited directly, or with .select("id").single() for a new job's id.
      return {
        insert: () =>
          Object.assign(Promise.resolve({ error: null }), {
            select: () => ({ single: () => Promise.resolve({ data: { id: "job-1" }, error: null }) }),
          }),
      };
    },
  },
}));

vi.mock("@/lib/sms-consent", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/sms-consent")>();
  return {
    ...real,
    smsOptInState: () => Promise.resolve("none"),
    startDoubleOptIn: (phone: string, name: string | null) => {
      h.startOptIn(phone, name);
      return Promise.resolve("sent");
    },
  };
});

vi.mock("@/lib/customer-intake", () => ({
  resolveCustomerPropertyEquipment: (input: unknown) => {
    h.intake(input);
    return Promise.resolve({ customerId: "c1", propertyId: "p1", equipmentId: null });
  },
}));

vi.mock("@/lib/notify-owner", () => ({
  notifyOwnerOfWebLead: (input: unknown) => {
    h.ownerAlert(input);
    return Promise.resolve();
  },
  notifyOwnerOfLowSurveyRating: () => Promise.resolve(),
  notifyOwnerOfVisitRequest: () => Promise.resolve(),
}));

vi.mock("@/lib/resend", () => ({
  RESEND_FROM_EMAIL: "test@example.com",
  resend: {
    emails: {
      send: (msg: unknown) => {
        h.emailSend(msg);
        return Promise.resolve({ error: null });
      },
    },
  },
}));

vi.mock("@/lib/receptionist/web-agent", () => ({
  respondToWebChat: (input: unknown) => {
    h.webChat(input);
    return Promise.resolve("hi");
  },
}));

import {
  LIMITS,
  OPT_IN_TEXTS_KEY,
  RATE_LIMITED_MESSAGE,
  allowAll,
  allowRequest,
  clientIpFrom,
  rateKey,
  resetRateLimitWarningForTests,
} from "@/lib/rate-limit-db";
import { signUpForSms } from "@/app/sms-signup/actions";
import { bookService } from "@/app/(marketing)/book/actions";
import { sendContactMessage } from "@/app/(marketing)/contact/actions";
import { submitSurvey } from "@/app/survey/[jobId]/actions";
import { unsubscribe } from "@/app/unsubscribe/[token]/actions";
import { requestVisit } from "@/app/visit/[token]/actions";
import { POST as chatPost } from "@/app/api/chat/route";

const IP = "203.0.113.5";
const UUID = "0b5a3a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function run<T>(p: Promise<T>): Promise<T | "redirected"> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") return "redirected";
    throw err;
  }
}

let keySeq = 0;
const freshKey = () => `test:${++keySeq}:${Date.now()}`;

beforeEach(() => {
  vi.clearAllMocks();
  h.blocked = () => false;
  h.rpcReply = null;
  h.redirected = null;
  resetRateLimitWarningForTests();
});

describe("clientIpFrom", () => {
  it("uses the first hop of x-forwarded-for", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": " 198.51.100.7 , 10.0.0.1" }))).toBe("198.51.100.7");
  });
  it("falls back to x-real-ip, then 'unknown'", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.8" }))).toBe("198.51.100.8");
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});

describe("rateKey", () => {
  it("hashes the value so no phone, email or IP is stored", () => {
    const key = rateKey("sms-signup", "phone", "508-555-0100");
    expect(key).toMatch(/^sms-signup:phone:[0-9a-f]{32}$/);
    expect(key).not.toContain("5085550100");
    expect(rateKey("contact", "email", "a@b.co")).not.toContain("a@b.co");
  });
  it("one phone in any format shares a counter", () => {
    const a = rateKey("book", "phone", "(508) 555-0100");
    expect(rateKey("book", "phone", "+1 508 555 0100")).toBe(a);
    expect(rateKey("book", "phone", "5085550100")).toBe(a);
  });
  it("email case and spaces don't matter; scopes and kinds stay apart", () => {
    expect(rateKey("contact", "email", " A@B.co ")).toBe(rateKey("contact", "email", "a@b.co"));
    expect(rateKey("book", "ip", IP)).not.toBe(rateKey("contact", "ip", IP));
  });
});

describe("allowRequest", () => {
  it("passes key, limit and window to the database and returns its answer", async () => {
    expect(await allowRequest("k1", 5, 3600)).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("rate_limit_hit", { p_key: "k1", p_limit: 5, p_window_seconds: 3600 });
    h.blocked = () => true;
    expect(await allowRequest("k1", 5, 3600)).toBe(false);
  });

  it("SQL 0074 not run: falls back to the memory limit and logs once", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.rpcReply = () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const key = freshKey();
    expect(await allowRequest(key, 2, 3600)).toBe(true);
    expect(await allowRequest(key, 2, 3600)).toBe(true);
    expect(await allowRequest(key, 2, 3600)).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("0074");
    log.mockRestore();
  });

  it("database error or a thrown call: falls back instead of blocking", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.rpcReply = () => ({ data: null, error: { code: "500", message: "boom" } });
    expect(await allowRequest(freshKey(), 1, 60)).toBe(true);
    h.rpcReply = () => Promise.reject(new Error("network down"));
    expect(await allowRequest(freshKey(), 1, 60)).toBe(true);
    log.mockRestore();
  });

  it("unexpected reply: falls back", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.rpcReply = () => ({ data: null, error: null });
    expect(await allowRequest(freshKey(), 1, 60)).toBe(true);
    log.mockRestore();
  });
});

describe("allowAll", () => {
  it("stops at the first rule over its limit", async () => {
    h.blocked = (key) => key === "b";
    const ok = await allowAll([
      { key: "a", limit: 1, windowSeconds: 60 },
      { key: "b", limit: 1, windowSeconds: 60 },
      { key: "c", limit: 1, windowSeconds: 60 },
    ]);
    expect(ok).toBe(false);
    expect(h.rpc.mock.calls.map((c) => c[1].p_key)).toEqual(["a", "b"]);
  });
});

describe("/sms-signup", () => {
  const signup = () => run(signUpForSms(null, form({ phone: "508-555-0100", consent: "on" })));

  it("allowed: checks IP, phone and the hourly cap, then texts", async () => {
    expect(await signup()).toBe("redirected");
    const calls = h.rpc.mock.calls.map((c) => c[1]);
    expect(calls).toEqual([
      { p_key: rateKey("sms-signup", "ip", IP), p_limit: 5, p_window_seconds: 3600 },
      { p_key: rateKey("sms-signup", "phone", "5085550100"), p_limit: 3, p_window_seconds: 86400 },
      { p_key: OPT_IN_TEXTS_KEY, p_limit: 100, p_window_seconds: 3600 },
    ]);
    expect(h.startOptIn).toHaveBeenCalledTimes(1);
  });

  for (const which of ["ip", "phone", "global"] as const) {
    it(`over the ${which} limit: inline error, no text`, async () => {
      h.blocked = (key) =>
        which === "global" ? key === OPT_IN_TEXTS_KEY : key.startsWith(`sms-signup:${which}:`);
      expect(await signup()).toEqual({ error: RATE_LIMITED_MESSAGE });
      expect(h.startOptIn).not.toHaveBeenCalled();
    });
  }
});

describe("/book", () => {
  const booking = (extra: Record<string, string> = {}) =>
    run(
      bookService(
        null,
        form({
          name: "Test Person",
          phone: "508-555-0100",
          address: "1 Test St",
          service_type: "AC repair",
          date: "2099-06-15",
          window: "morning",
          ...extra,
        })
      )
    );

  it("over the IP or phone limit: inline error, nothing saved, no text or alert", async () => {
    for (const kind of ["ip", "phone"]) {
      vi.clearAllMocks();
      h.blocked = (key) => key.startsWith(`book:${kind}:`);
      expect(await booking({ sms_consent: "on" })).toEqual({ error: RATE_LIMITED_MESSAGE });
      expect(h.intake).not.toHaveBeenCalled();
      expect(h.from).not.toHaveBeenCalled();
      expect(h.startOptIn).not.toHaveBeenCalled();
      expect(h.ownerAlert).not.toHaveBeenCalled();
    }
  });

  it("limits are 10 an hour per IP and 5 a day per phone", async () => {
    await booking();
    expect(h.rpc.mock.calls.map((c) => c[1])).toEqual([
      { p_key: rateKey("book", "ip", IP), p_limit: LIMITS.bookPerIp.limit, p_window_seconds: 3600 },
      { p_key: rateKey("book", "phone", "5085550100"), p_limit: LIMITS.bookPerPhone.limit, p_window_seconds: 86400 },
    ]);
    expect(LIMITS.bookPerIp.limit).toBe(10);
    expect(LIMITS.bookPerPhone.limit).toBe(5);
  });

  it("hourly text cap reached: booking still saved, Reply YES text skipped", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.blocked = (key) => key === OPT_IN_TEXTS_KEY;
    expect(await booking({ sms_consent: "on" })).toBe("redirected");
    expect(h.from).toHaveBeenCalledWith("jobs");
    expect(h.startOptIn).not.toHaveBeenCalled();
    expect(h.ownerAlert).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("under the text cap: Reply YES text goes out", async () => {
    expect(await booking({ sms_consent: "on" })).toBe("redirected");
    expect(h.startOptIn).toHaveBeenCalledTimes(1);
  });
});

describe("/contact", () => {
  const contact = () =>
    run(sendContactMessage(null, form({ name: "Test Person", email: "a@b.co", message: "Hello" })));

  it("over the IP or email limit: inline error, no email sent", async () => {
    for (const kind of ["ip", "email"]) {
      vi.clearAllMocks();
      h.blocked = (key) => key.startsWith(`contact:${kind}:`);
      expect(await contact()).toEqual({ error: RATE_LIMITED_MESSAGE });
      expect(h.emailSend).not.toHaveBeenCalled();
    }
  });

  it("limits are 10 an hour per IP and 5 a day per email", async () => {
    await contact();
    expect(h.rpc.mock.calls.map((c) => c[1])).toEqual([
      { p_key: rateKey("contact", "ip", IP), p_limit: 10, p_window_seconds: 3600 },
      { p_key: rateKey("contact", "email", "a@b.co"), p_limit: 5, p_window_seconds: 86400 },
    ]);
  });
});

describe("/api/chat", () => {
  const chat = () =>
    chatPost(
      new Request("https://x.test/api/chat", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.20", "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1", message: "hi" }),
      })
    );

  it("over the hourly limit: 429 with the plain message, no AI call", async () => {
    h.blocked = (key) => key.startsWith("chat:ip:");
    const res = await chat();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: RATE_LIMITED_MESSAGE });
    expect(h.webChat).not.toHaveBeenCalled();
  });

  it("under the limit: 60 an hour per IP, then answers", async () => {
    const res = await chat();
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_key: rateKey("chat", "ip", "198.51.100.20"),
      p_limit: 60,
      p_window_seconds: 3600,
    });
  });
});

describe("survey, unsubscribe and visit links", () => {
  beforeEach(() => {
    h.blocked = (key) => key.startsWith("token-link:ip:");
  });

  it("survey: inline error, nothing saved", async () => {
    expect(await run(submitSurvey(null, form({ job_id: UUID, rating: "5" })))).toEqual({ error: RATE_LIMITED_MESSAGE });
    expect(h.from).not.toHaveBeenCalled();
  });

  it("unsubscribe: inline error, nothing changed", async () => {
    expect(await run(unsubscribe({}, form({ token: UUID })))).toEqual({ error: RATE_LIMITED_MESSAGE });
    expect(h.from).not.toHaveBeenCalled();
  });

  it("visit request: inline error, nothing changed", async () => {
    expect(await run(requestVisit({}, form({ token: UUID })))).toEqual({ error: RATE_LIMITED_MESSAGE });
    expect(h.from).not.toHaveBeenCalled();
  });
});
