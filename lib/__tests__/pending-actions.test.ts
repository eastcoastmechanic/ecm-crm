import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  action_name: string;
  tool_input: unknown;
  consumed_at: string | null;
  expires_at: string;
  result: string | null;
};

const table: { row: Row | null } = { row: null };

// Just enough of the supabase query builder for confirmPendingAction. The claim
// is one synchronous check-and-set, like the single conditional UPDATE it stands for.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Partial<Row> | null = null;
      let mode: "select" | "update" = "select";
      const matching = () => (table.row && filters.every((f) => f(table.row!)) ? table.row : null);
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (p: Partial<Row>) => {
          mode = "update";
          patch = p;
          return builder;
        },
        eq: (col: keyof Row, val: unknown) => (filters.push((r) => r[col] === val), builder),
        is: (col: keyof Row, val: unknown) => (filters.push((r) => r[col] === val), builder),
        gt: (col: keyof Row, val: string) => (filters.push((r) => String(r[col]) > val), builder),
        single: async () => {
          const r = matching();
          return r ? { data: { ...r }, error: null } : { data: null, error: { message: "not found" } };
        },
        maybeSingle: async () => {
          const r = matching();
          if (mode === "update" && r) Object.assign(r, patch);
          return { data: r ? { id: r.id } : null, error: null };
        },
        then: (resolve: (v: unknown) => void) => {
          const r = matching();
          if (mode === "update" && r) Object.assign(r, patch);
          resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  },
}));

import { confirmPendingAction } from "../pending-actions";

const future = () => new Date(Date.now() + 10 * 60_000).toISOString();

beforeEach(() => {
  table.row = {
    id: "tok-1",
    action_name: "delete_thing",
    tool_input: { id: "x" },
    consumed_at: null,
    expires_at: future(),
    result: null,
  };
});

describe("confirmPendingAction", () => {
  it("runs the action once and records the result", async () => {
    const run = vi.fn(async () => "Deleted x.");
    const out = await confirmPendingAction("tok-1", { delete_thing: run });
    expect(out).toBe("Deleted x.");
    expect(run).toHaveBeenCalledTimes(1);
    expect(table.row?.consumed_at).not.toBeNull();
    expect(table.row?.result).toBe("Deleted x.");
  });

  it("hands the executor its token (card charges use it as the Stripe idempotency key)", async () => {
    const run = vi.fn(async () => "ok");
    await confirmPendingAction("tok-1", { delete_thing: run });
    expect(run).toHaveBeenCalledWith(table.row?.tool_input, { token: "tok-1" });
  });

  it("lets only one of two simultaneous confirms run", async () => {
    const run = vi.fn(async () => "Deleted x.");
    const [a, b] = await Promise.all([
      confirmPendingAction("tok-1", { delete_thing: run }),
      confirmPendingAction("tok-1", { delete_thing: run }),
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect([a, b].filter((m) => m === "Deleted x.")).toHaveLength(1);
    expect([a, b].some((m) => /already executed|running right now/.test(m))).toBe(true);
  });

  it("gives the token back when the action fails, so it can be retried", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("Deleted x.");
    const first = await confirmPendingAction("tok-1", { delete_thing: run });
    expect(first).toMatch(/Execution failed: boom/);
    expect(table.row?.consumed_at).toBeNull();
    expect(await confirmPendingAction("tok-1", { delete_thing: run })).toBe("Deleted x.");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("refuses a token that was already used", async () => {
    table.row!.consumed_at = new Date().toISOString();
    const run = vi.fn();
    expect(await confirmPendingAction("tok-1", { delete_thing: run })).toMatch(/already executed/);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses an expired token", async () => {
    table.row!.expires_at = new Date(Date.now() - 1000).toISOString();
    const run = vi.fn();
    expect(await confirmPendingAction("tok-1", { delete_thing: run })).toMatch(/expired/);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses an unknown token and an action with no executor", async () => {
    expect(await confirmPendingAction("nope", {})).toMatch(/No pending action/);
    expect(await confirmPendingAction("tok-1", {})).toMatch(/No executor/);
    expect(table.row?.consumed_at).toBeNull();
  });
});
