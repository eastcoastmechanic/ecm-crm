import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/copilot-actions", () => ({ getCopilotActionTools: () => [] }));
vi.mock("@/lib/require-role", () => ({ runAsStaffRole: vi.fn() }));

import { POST } from "../../app/api/copilot-actions/[action]/route";

const call = (key?: string) =>
  POST(
    new Request("https://example.test/api/copilot-actions/find_customer", {
      method: "POST",
      headers: key === undefined ? {} : { "x-api-key": key },
      body: "{}",
    }),
    { params: Promise.resolve({ action: "find_customer" }) }
  );

describe("copilot-actions key check", () => {
  afterEach(() => vi.unstubAllEnvs());

  describe("with the key set", () => {
    beforeEach(() => vi.stubEnv("COPILOT_ACTIONS_API_KEY", "real-key-value"));

    it("rejects a missing key", async () => expect((await call()).status).toBe(401));
    it("rejects a wrong key", async () => expect((await call("nope")).status).toBe(401));
    it("lets the right key through to the action lookup", async () =>
      expect((await call("real-key-value")).status).toBe(404));
  });

  it("fails closed when the key is not configured", async () => {
    vi.stubEnv("COPILOT_ACTIONS_API_KEY", "");
    expect((await call("undefined")).status).toBe(401);
    expect((await call("")).status).toBe(401);
  });
});
