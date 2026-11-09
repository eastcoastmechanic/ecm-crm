import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The printed field sheet sorts open jobs into "ongoing" and "leftover" by the
// New York day, not the server's UTC day.

const h = vi.hoisted(() => ({ jobs: [] as Record<string, unknown>[] }));

vi.mock("@/lib/field-board", () => ({
  getFieldBoardSheet: () =>
    Promise.resolve({ jobs: h.jobs, tasks: [], events: [], field_board_url: "", crm_url: "" }),
}));
// No unpaid Square invoices: every query chain resolves to an empty list.
vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "gt", "order", "limit"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return { supabase: { from: () => chain } };
});

import { getFieldSheetPayload, startOfToday } from "../field-sheet";

const job = (id: string, scheduled_at: string) => ({
  id,
  customer: `Customer ${id}`,
  address: "1 Test St",
  status: "scheduled",
  notes: null,
  scheduled_at,
});

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  h.jobs = [];
});

describe("startOfToday", () => {
  it("is midnight New York time, EST and EDT", () => {
    expect(startOfToday(new Date("2026-11-10T02:00:00Z")).toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(startOfToday(new Date("2026-07-15T12:00:00Z")).toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });

  it("late evening in New York is still that day, even though UTC has rolled over", () => {
    // 10 PM ET Nov 9 is 03:00 UTC Nov 10.
    expect(startOfToday(new Date("2026-11-10T03:00:00Z")).toISOString()).toBe("2026-11-09T05:00:00.000Z");
  });
});

describe("field sheet day selection", () => {
  it("at 10 PM ET, a job from this morning is ongoing and yesterday's is leftover", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T03:00:00Z")); // 10 PM ET, Nov 9
    h.jobs = [
      job("today", "2026-11-09T14:00:00Z"), // 9 AM ET Nov 9
      job("yesterday", "2026-11-08T22:00:00Z"), // 5 PM ET Nov 8
    ];
    const sheet = await getFieldSheetPayload();
    expect(sheet.ongoing.map((l) => l.id)).toEqual(["today"]);
    expect(sheet.leftover.map((l) => l.id)).toEqual(["yesterday"]);
  });

  it("just after midnight ET, last evening's job counts as leftover", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T05:30:00Z")); // 12:30 AM ET, Nov 10
    h.jobs = [job("last-night", "2026-11-10T00:30:00Z")]; // 7:30 PM ET Nov 9
    const sheet = await getFieldSheetPayload();
    expect(sheet.leftover.map((l) => l.id)).toEqual(["last-night"]);
    expect(sheet.ongoing).toEqual([]);
  });
});
