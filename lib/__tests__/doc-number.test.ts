import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: { data: null as unknown, error: null as null | { code?: string; message: string } },
  rpcCalls: [] as { fn: string; args: unknown }[],
  count: 0,
  recent: [] as { doc_number: string | null }[],
  likeArgs: [] as unknown[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      h.rpcCalls.push({ fn, args });
      return h.rpc;
    },
    from: () => {
      let head = false;
      const builder: Record<string, unknown> = {};
      builder.select = (_cols: string, opts?: { head?: boolean }) => {
        head = Boolean(opts?.head);
        return builder;
      };
      for (const m of ["eq", "order", "limit"]) builder[m] = () => builder;
      builder.like = (...args: unknown[]) => {
        h.likeArgs.push(args);
        return builder;
      };
      builder.then = (resolve: (v: unknown) => void) =>
        resolve(head ? { count: h.count, error: null } : { data: h.recent, error: null });
      return builder;
    },
  },
}));

import {
  allocateDocNumber,
  docNumberPrefix,
  fallbackDocNumberValue,
  formatDocNumber,
  isMissingFunctionError,
  nextDocNumberOrThrow,
  parseDocNumber,
} from "../doc-number";

beforeEach(() => {
  h.rpc = { data: null, error: null };
  h.rpcCalls = [];
  h.count = 0;
  h.recent = [];
  h.likeArgs = [];
});

describe("doc number format", () => {
  it("uses the existing prefixes", () => {
    expect(docNumberPrefix("estimate")).toBe("EST");
    expect(docNumberPrefix("invoice")).toBe("INV");
    expect(docNumberPrefix("proposal")).toBe("PROP");
    expect(docNumberPrefix("contract")).toBe("CON");
    expect(docNumberPrefix("warranty")).toBe("WTY");
    expect(docNumberPrefix("pm_report")).toBe("PM");
    expect(docNumberPrefix("assessment")).toBe("CA");
    expect(docNumberPrefix("something_new")).toBe("DOC");
    expect(formatDocNumber("INV", 1042)).toBe("INV-1042");
  });

  it("parses only its own prefix", () => {
    expect(parseDocNumber("INV", "INV-1042")).toBe(1042);
    expect(parseDocNumber("INV", " INV-1042 ")).toBe(1042);
    expect(parseDocNumber("INV", "EST-1042")).toBeNull();
    expect(parseDocNumber("PM", "PROP-1001")).toBeNull();
    expect(parseDocNumber("INV", "INV-")).toBeNull();
    expect(parseDocNumber("INV", "000123")).toBeNull();
    expect(parseDocNumber("INV", null)).toBeNull();
  });
});

describe("fallbackDocNumberValue (before SQL 0071)", () => {
  it("is count + 1001 when nothing is higher", () => {
    expect(fallbackDocNumberValue("INV", 0, [])).toBe(1001);
    expect(fallbackDocNumberValue("INV", 3, ["INV-1001", "INV-1002", "INV-1003"])).toBe(1004);
  });

  it("skips past a number still in use after a delete", () => {
    // INV-1001 was deleted: count is 2, old rule said INV-1003 again.
    expect(fallbackDocNumberValue("INV", 2, ["INV-1003", "INV-1002"])).toBe(1004);
  });

  it("ignores other prefixes and odd numbers", () => {
    expect(fallbackDocNumberValue("INV", 0, ["EST-5000", "Square 77", null])).toBe(1001);
  });
});

describe("isMissingFunctionError", () => {
  it("knows the not-installed errors", () => {
    expect(isMissingFunctionError({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isMissingFunctionError({ code: "42883", message: "x" })).toBe(true);
    expect(
      isMissingFunctionError({ message: "Could not find the function public.next_doc_number(p_prefix) in the schema cache" })
    ).toBe(true);
  });

  it("does not treat other errors as missing", () => {
    expect(isMissingFunctionError(null)).toBe(false);
    expect(isMissingFunctionError({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isMissingFunctionError({ code: "P0001", message: "next_doc_number: bad prefix" })).toBe(false);
  });
});

describe("allocateDocNumber", () => {
  it("uses next_doc_number when SQL 0071 is in", async () => {
    h.rpc = { data: "INV-1043", error: null };
    expect(await allocateDocNumber("invoice")).toEqual({ docNumber: "INV-1043" });
    expect(h.rpcCalls).toEqual([{ fn: "next_doc_number", args: { p_prefix: "INV" } }]);
  });

  it("falls back to the old rule when the function is not there yet", async () => {
    h.rpc = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    h.count = 2;
    h.recent = [{ doc_number: "CON-1003" }, { doc_number: "CON-1002" }];
    expect(await allocateDocNumber("contract")).toEqual({ docNumber: "CON-1004" });
    expect(h.likeArgs).toEqual([["doc_number", "CON-%"]]);
  });

  it("returns an error, not a guessed number, on any other database error", async () => {
    h.rpc = { data: null, error: { code: "57014", message: "statement timeout" } };
    const result = await allocateDocNumber("estimate");
    expect(result.error).toMatch(/statement timeout/);
    expect(result.docNumber).toBeUndefined();
    await expect(nextDocNumberOrThrow("estimate")).rejects.toThrow(/statement timeout/);
  });
});
