import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { claimOutcome } from "@/lib/daily-brief-guard";

describe("claimOutcome", () => {
  it("owns the post when the insert works", () => {
    expect(claimOutcome(null)).toBe("claimed");
  });

  it("skips when today's card for that channel was already claimed", () => {
    expect(claimOutcome({ code: "23505" })).toBe("already_posted");
  });

  it("posts anyway when the guard table isn't there yet or the read fails", () => {
    expect(claimOutcome({ code: "42P01" })).toBe("unguarded");
    expect(claimOutcome({})).toBe("unguarded");
  });
});
