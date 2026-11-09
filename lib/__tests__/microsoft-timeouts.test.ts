import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Call, Handler } from "./fake-supabase";

const h = vi.hoisted(() => ({
  handler: (() => ({})) as Handler,
  calls: [] as Call[],
  alert: vi.fn(),
}));

vi.mock("@/lib/supabase", async () => {
  const { fakeSupabase } = await import("./fake-supabase");
  const fake = fakeSupabase((call) => {
    h.calls.push(call);
    return h.handler(call);
  });
  return { supabase: fake.client };
});
vi.mock("@/lib/notify-owner", () => ({
  notifyOwnerOfSystemProblem: (...a: unknown[]) => (h.alert(...a), Promise.resolve()),
}));

import { GRAPH_CALL_TIMEOUT_MS, graphFetch, MS_TOKEN_TIMEOUT_MS } from "../graph-auth";
import { syncJobToPlanner } from "../planner-connector";
import { syncJobToGraph } from "../graph-connector";
import { delegatedFetch, getDelegatedToken } from "../microsoft-delegated";
import { encryptToken } from "../token-crypto";
import { has, payload } from "./fake-supabase";

const TOKEN_PURPOSE = "ecm-crm microsoft refresh token v1";

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  process.env.MS_GRAPH_TENANT_ID = "tenant";
  process.env.MS_GRAPH_CLIENT_ID = "client";
  process.env.MS_GRAPH_CERT_PRIVATE_KEY = privateKey;
  process.env.MS_GRAPH_CERT_THUMBPRINT = "thumb";
  process.env.MS_PLANNER_PLAN_ID = "plan";
  process.env.MS_PLANNER_BUCKET_TASKS_ID = "b-tasks";
  process.env.MS_PLANNER_BUCKET_JOBS_ID = "b-jobs";
});

/** A Microsoft call that never answers: it only ends when its signal aborts. */
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // no time limit: would hang forever
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  });
}

/** Every time limit fires at once, so the tests don't wait 8 to 10 seconds. */
function timeLimitsFireNow() {
  const asked: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    asked.push(ms);
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), 0);
    return c.signal;
  });
  return asked;
}

beforeEach(() => {
  h.calls = [];
  h.alert.mockClear();
  h.handler = () => ({});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("app-only Graph calls have a time limit", () => {
  it("gives up on a token request that never answers", async () => {
    const asked = timeLimitsFireNow();
    vi.stubGlobal("fetch", hangingFetch());
    await expect(graphFetch("/me")).rejects.toMatchObject({ name: "TimeoutError" });
    expect(asked).toContain(MS_TOKEN_TIMEOUT_MS);
  });

  it("Planner sync logs a timeout and returns false instead of holding the job action", async () => {
    timeLimitsFireNow();
    vi.stubGlobal("fetch", hangingFetch());
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.handler = (call) =>
      call.table === "jobs" && call.end === "single"
        ? { data: { planner_task_id: null, scheduled_at: null, customers: null, properties: null } }
        : {};
    await expect(syncJobToPlanner("job-1", "in_progress")).resolves.toBe(false);
    expect(log).toHaveBeenCalled();
  });

  it("Copilot index sync logs a timeout and returns false", async () => {
    timeLimitsFireNow();
    vi.stubGlobal("fetch", hangingFetch());
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.handler = (call) =>
      call.table === "jobs" && call.end === "single"
        ? { data: { id: "job-1", status: "scheduled", scheduled_at: null, notes: null, customers: null, properties: null } }
        : {};
    await expect(syncJobToGraph("job-1")).resolves.toBe(false);
  });

  it("puts the Graph call limit on the request itself", async () => {
    const asked = timeLimitsFireNow();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("login.microsoftonline.com")) {
        return Promise.resolve(Response.json({ access_token: "app-token", expires_in: 3600 }));
      }
      return Promise.resolve(init?.signal ? new Response("{}") : new Response("no limit", { status: 599 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await graphFetch("/me");
    expect(res.status).toBe(200);
    expect(asked).toContain(GRAPH_CALL_TIMEOUT_MS);
  });
});

describe("OneNote (delegated) sign-in", () => {
  function connection(lastErrorFlips: boolean) {
    const sealed = encryptToken("refresh-1", process.env.MS_GRAPH_CERT_PRIVATE_KEY!, TOKEN_PURPOSE);
    h.handler = (call) => {
      if (call.table !== "microsoft_connections") return {};
      if (call.end === "maybeSingle") return { data: { refresh_token_enc: sealed, connected_at: "2026-11-01T00:00:00Z" } };
      if (payload(call, "update") && has(call, "is", "last_error", null)) return { data: lastErrorFlips ? [{ id: "onenote" }] : [] };
      return { data: null };
    };
  }

  it("a token refresh that never answers returns null, keeps the saved sign-in and sends no alert", async () => {
    timeLimitsFireNow();
    vi.stubGlobal("fetch", hangingFetch());
    vi.spyOn(console, "error").mockImplementation(() => {});
    connection(true);
    await expect(getDelegatedToken()).resolves.toBeNull();
    expect(h.calls.some((c) => payload(c, "update"))).toBe(false);
    expect(h.alert).not.toHaveBeenCalled();
    await expect(delegatedFetch("/me")).resolves.toBeNull();
  });

  it("alerts the owner once, the first time Microsoft refuses the saved sign-in", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({ error: "invalid_grant" }, { status: 400 }))));
    connection(true);
    await expect(getDelegatedToken()).resolves.toBeNull();
    expect(h.alert).toHaveBeenCalledTimes(1);
    const alert = h.alert.mock.calls[0][0] as { title: string; body: string; path: string };
    expect(alert.title).toBe("OneNote sign-in expired");
    expect(alert.body).toContain("Reconnect at Account → Connect OneNote");
    expect(alert.body).toContain("invalid_grant");
    expect(alert.path).toBe("/account");
    const update = h.calls.find((c) => payload(c, "update"));
    expect(payload(update!, "update")?.last_error).toContain("invalid_grant");
  });

  it("does not alert again while the sign-in is still broken, but keeps the reason current", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({ error: "invalid_grant" }, { status: 400 }))));
    connection(false);
    await expect(getDelegatedToken()).resolves.toBeNull();
    expect(h.alert).not.toHaveBeenCalled();
    const updates = h.calls.filter((c) => payload(c, "update"));
    expect(updates).toHaveLength(2);
    expect(has(updates[1], "is", "last_error", null)).toBe(false);
  });
});
