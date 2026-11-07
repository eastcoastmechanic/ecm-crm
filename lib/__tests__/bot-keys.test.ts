import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { BOT_KEY_PREFIX, BOT_NAME_PATTERN, fieldBoardCaller, newBotKey } from "../bot-keys";
import { hashToken } from "../oauth";

const req = (token?: string) =>
  new Request("https://example.test/api/field-board/events", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe("fieldBoardCaller", () => {
  const quo = newBotKey();
  const lookup = vi.fn(async (hash: string) => (hash === quo.hash ? { id: "k1", name: "quo" } : null));

  beforeEach(() => {
    vi.stubEnv("FIELD_BOARD_SECRET", "board-secret-value");
    vi.stubEnv("FIELD_BOARD_APP_KEY", "app-key-value");
    vi.stubEnv("MCP_API_KEY", "mcp-key-value");
    lookup.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the old shared keys with no bot name", async () => {
    expect(await fieldBoardCaller(req("board-secret-value"), lookup)).toEqual({ bot: null });
    expect(await fieldBoardCaller(req("app-key-value"), lookup)).toEqual({ bot: null });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("names the bot for a live bot key", async () => {
    expect(await fieldBoardCaller(req(quo.key), lookup)).toEqual({ bot: "quo" });
    expect(lookup).toHaveBeenCalledWith(hashToken(quo.key));
  });

  it("rejects a revoked or unknown bot key", async () => {
    expect(await fieldBoardCaller(req(newBotKey().key), lookup)).toBeNull();
  });

  it("rejects other secrets, a missing token, and skips the lookup for non-bot tokens", async () => {
    expect(await fieldBoardCaller(req("mcp-key-value"), lookup)).toBeNull();
    expect(await fieldBoardCaller(req(), lookup)).toBeNull();
    expect(await fieldBoardCaller(req("nope"), lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("fails closed when the lookup finds nothing (e.g. SQL 0068 not run) and shared keys are unset", async () => {
    vi.stubEnv("FIELD_BOARD_SECRET", "");
    vi.stubEnv("FIELD_BOARD_APP_KEY", "");
    expect(await fieldBoardCaller(req("anything"), async () => null)).toBeNull();
    expect(await fieldBoardCaller(req(quo.key), async () => null)).toBeNull();
  });
});

describe("newBotKey", () => {
  it("makes a prefixed, unique key and stores only its hash and last 4", () => {
    const a = newBotKey();
    const b = newBotKey();
    expect(a.key.startsWith(BOT_KEY_PREFIX)).toBe(true);
    expect(a.key).not.toBe(b.key);
    expect(a.hash).toBe(hashToken(a.key));
    expect(a.hash).not.toContain(a.key);
    expect(a.hint).toBe(a.key.slice(-4));
  });
});

describe("BOT_NAME_PATTERN", () => {
  it("allows the names the bots already use and blocks junk", () => {
    for (const ok of ["quo", "billing", "office", "field-board", "ecm-shop-ops"]) expect(BOT_NAME_PATTERN.test(ok)).toBe(true);
    for (const bad of ["", "q", "-quo", "Quo", "quo bot", "a".repeat(41)]) expect(BOT_NAME_PATTERN.test(bad)).toBe(false);
  });
});
