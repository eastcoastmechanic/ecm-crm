import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The proxy is what checks the staff sign-in and sets the staff role header.
// It runs on every app route (catch-all matcher) and strips any client-sent
// x-staff-role, so a page that is forgotten can't trust a forged header. These
// tests cover the matcher, the header stripping, and the role proof.

const supabaseState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: null as string | null,
  clients: 0,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => {
    supabaseState.clients += 1;
    return {
      auth: { getUser: async () => ({ data: { user: supabaseState.user } }) },
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: supabaseState.role ? { role: supabaseState.role } : null }) }),
        }),
      }),
    };
  },
}));

const headerStore = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => headerStore.current }));

import { config, isInternalPath, proxy } from "@/proxy";
import { getStaffRole, runAsStaffRole } from "@/lib/require-role";
import { signStaffRole, verifyStaffRole } from "@/lib/staff-role-proof";

const root = process.cwd();
const internalDir = join(root, "app", "(internal)");
const routeFolders = readdirSync(internalDir).filter((name) => {
  if (name.startsWith("_") || name.startsWith("(")) return false;
  return statSync(join(internalDir, name)).isDirectory();
});

// The matcher is one path-to-regexp source made of a single regex group, so
// anchoring it gives the same set of paths Next matches.
const matcher = new RegExp(`^${config.matcher[0]}$`);

/** Request headers the proxy forwards upstream, read from NextResponse.next({ request: { headers } }). */
function forwarded(response: Response): Record<string, string> | null {
  const list = response.headers.get("x-middleware-override-headers");
  if (list === null) return null;
  const out: Record<string, string> = {};
  for (const key of list.split(",").filter(Boolean)) {
    out[key] = response.headers.get(`x-middleware-request-${key}`) ?? "";
  }
  return out;
}

const FORGED = { "x-staff-role": "owner", "x-staff-role-proof": "123.abc" };

beforeEach(() => {
  vi.stubEnv("STAFF_ROLE_SECRET", "test-secret-for-proofs");
  supabaseState.user = null;
  supabaseState.role = null;
  supabaseState.clients = 0;
  headerStore.current = new Headers();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy matcher", () => {
  it("finds the internal route folders", () => {
    expect(routeFolders.length).toBeGreaterThan(10);
  });

  for (const folder of routeFolders) {
    it(`/${folder} runs the proxy and needs a staff sign-in`, () => {
      expect(matcher.test(`/${folder}`)).toBe(true);
      expect(matcher.test(`/${folder}/abc/def`)).toBe(true);
      expect(isInternalPath(`/${folder}`)).toBe(true);
      expect(isInternalPath(`/${folder}/abc`)).toBe(true);
    });
  }

  it.each([
    "/",
    "/about",
    "/book",
    "/login",
    "/portal",
    "/portal/documents/x",
    "/survey/abc",
    "/unsubscribe/tok",
    "/api/stripe/webhook",
    "/api/cron/square-sync",
    "/api/mcp",
    "/api/field-board/events",
    "/api/oauth/token",
    "/.well-known/oauth-authorization-server",
    "/customers/x.png",
    "/documents/abc/pdf",
  ])("runs on %s", (path) => {
    expect(matcher.test(path)).toBe(true);
  });

  it.each([
    "/_next/static/chunks/main.js",
    "/_next/image",
    "/favicon.ico",
    "/logo.png",
    "/sw.js",
    "/manifest.webmanifest",
    "/fonts/DMSans-Bold.ttf",
    "/icons/icon-192.png",
    "/site/work/boiler-room.jpg",
    "/forms/mass-save-ashp-2026.pdf",
  ])("skips static file %s", (path) => {
    expect(matcher.test(path)).toBe(false);
  });
});

describe("proxy strips forged staff headers", () => {
  it.each(["/", "/about", "/api/stripe/webhook", "/api/field-board/events", "/api/mcp", "/login"])(
    "on public path %s, without a sign-in lookup",
    async (path) => {
      const response = await proxy(new NextRequest(`https://crm.test${path}`, { headers: { ...FORGED, "x-other": "kept" } }));
      const headers = forwarded(response);
      expect(headers).not.toBeNull();
      expect(headers).not.toHaveProperty("x-staff-role");
      expect(headers).not.toHaveProperty("x-staff-role-proof");
      expect(headers?.["x-other"]).toBe("kept");
      expect(supabaseState.clients).toBe(0);
    }
  );

  it("on the portal", async () => {
    supabaseState.user = { id: "u1" };
    const response = await proxy(new NextRequest("https://crm.test/portal", { headers: FORGED }));
    expect(forwarded(response)).not.toHaveProperty("x-staff-role");
  });

  it("an internal page with a forged header and no sign-in goes to login", async () => {
    const response = await proxy(new NextRequest("https://crm.test/log", { headers: FORGED }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?redirect=%2Flog");
  });

  it("a signed-in tech can't raise their role with a forged header", async () => {
    supabaseState.user = { id: "u1" };
    supabaseState.role = "tech";
    const response = await proxy(new NextRequest("https://crm.test/field-board", { headers: FORGED }));
    const headers = forwarded(response)!;
    expect(headers["x-staff-role"]).toBe("tech");
    expect(await verifyStaffRole("tech", headers["x-staff-role-proof"])).toBe(true);
  });

  it("a signed-in owner gets the role and a proof getStaffRole accepts", async () => {
    supabaseState.user = { id: "u1" };
    supabaseState.role = "owner";
    const response = await proxy(new NextRequest("https://crm.test/dashboard"));
    headerStore.current = new Headers(forwarded(response)!);
    expect(await getStaffRole()).toBe("owner");
  });

  it("no role is set when there is no server secret", async () => {
    vi.stubEnv("STAFF_ROLE_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    supabaseState.user = { id: "u1" };
    supabaseState.role = "owner";
    const response = await proxy(new NextRequest("https://crm.test/dashboard", { headers: FORGED }));
    expect(forwarded(response)).not.toHaveProperty("x-staff-role");
  });
});

describe("getStaffRole needs the proxy's proof", () => {
  it("ignores a forged role with no proof", async () => {
    headerStore.current = new Headers({ "x-staff-role": "owner" });
    expect(await getStaffRole()).toBeNull();
  });

  it("ignores a forged role with a made-up proof", async () => {
    headerStore.current = new Headers({ "x-staff-role": "owner", "x-staff-role-proof": `${Date.now()}.${"a".repeat(64)}` });
    expect(await getStaffRole()).toBeNull();
  });

  it("ignores a real proof for a different role", async () => {
    const techProof = await signStaffRole("tech");
    headerStore.current = new Headers({ "x-staff-role": "owner", "x-staff-role-proof": techProof! });
    expect(await getStaffRole()).toBeNull();
  });

  it("ignores a proof made with another secret", async () => {
    const proof = await signStaffRole("owner");
    vi.stubEnv("STAFF_ROLE_SECRET", "a-different-deployment");
    headerStore.current = new Headers({ "x-staff-role": "owner", "x-staff-role-proof": proof! });
    expect(await getStaffRole()).toBeNull();
  });

  it("ignores a stale proof", async () => {
    const proof = await signStaffRole("owner", Date.now() - 11 * 60 * 1000);
    headerStore.current = new Headers({ "x-staff-role": "owner", "x-staff-role-proof": proof! });
    expect(await getStaffRole()).toBeNull();
  });

  it("fails closed with no server secret", async () => {
    const proof = await signStaffRole("owner");
    vi.stubEnv("STAFF_ROLE_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    headerStore.current = new Headers({ "x-staff-role": "owner", "x-staff-role-proof": proof! });
    expect(await getStaffRole()).toBeNull();
  });

  it("accepts a fresh proof from the proxy", async () => {
    const proof = await signStaffRole("office");
    headerStore.current = new Headers({ "x-staff-role": "office", "x-staff-role-proof": proof! });
    expect(await getStaffRole()).toBe("office");
  });

  it("runAsStaffRole still works for MCP and Copilot routes (no header needed)", async () => {
    expect(await runAsStaffRole("owner", () => getStaffRole())).toBe("owner");
  });
});
