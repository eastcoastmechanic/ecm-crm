import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/job-lifecycle", () => ({ applyJobStatus: vi.fn() }));
vi.mock("@/lib/planner-connector", () => ({ listOpenPlannerTasks: vi.fn() }));
vi.mock("@/lib/teams", () => ({ postToTeams: vi.fn() }));

import { fieldBoardAuthorized } from "../field-board";

const req = (token?: string) =>
  new Request("https://example.test/api/field-board/sheet", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe("fieldBoardAuthorized", () => {
  beforeEach(() => {
    vi.stubEnv("FIELD_BOARD_SECRET", "board-secret-value");
    vi.stubEnv("FIELD_BOARD_APP_KEY", "app-key-value");
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    vi.stubEnv("MCP_API_KEY", "mcp-key-value");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the two field board keys", () => {
    expect(fieldBoardAuthorized(req("board-secret-value"))).toBe(true);
    expect(fieldBoardAuthorized(req("app-key-value"))).toBe(true);
  });

  it("rejects the cron and MCP secrets", () => {
    expect(fieldBoardAuthorized(req("cron-secret-value"))).toBe(false);
    expect(fieldBoardAuthorized(req("mcp-key-value"))).toBe(false);
  });

  it("rejects a missing or wrong token", () => {
    expect(fieldBoardAuthorized(req())).toBe(false);
    expect(fieldBoardAuthorized(req("nope"))).toBe(false);
  });

  it("fails closed when the field board keys are not set", () => {
    vi.stubEnv("FIELD_BOARD_SECRET", "");
    vi.stubEnv("FIELD_BOARD_APP_KEY", "");
    expect(fieldBoardAuthorized(req("anything"))).toBe(false);
  });
});
