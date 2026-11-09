import { describe, expect, it } from "vitest";
import { chunk, fetchAllRows, pageLimit } from "../fetch-all";

describe("pageLimit", () => {
  it("defaults to one step and ignores junk", () => {
    expect(pageLimit(undefined, 200, 1000)).toBe(200);
    expect(pageLimit("abc", 200, 1000)).toBe(200);
    expect(pageLimit("-5", 200, 1000)).toBe(200);
    expect(pageLimit("0", 200, 1000)).toBe(200);
  });

  it("rounds up to a step and caps at the max", () => {
    expect(pageLimit("400", 200, 1000)).toBe(400);
    expect(pageLimit("401", 200, 1000)).toBe(600);
    expect(pageLimit("999999", 200, 1000)).toBe(1000);
    expect(pageLimit(["600", "800"], 200, 1000)).toBe(600);
  });
});

describe("chunk", () => {
  it("splits ids into URL-sized groups", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
    expect(chunk(Array.from({ length: 151 }, (_, i) => i)).map((c) => c.length)).toEqual([150, 1]);
  });
});

function fakeTable(total: number, cap = 1000) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    // Like PostgREST: never more than `cap` rows, whatever range was asked for.
    const end = Math.min(to + 1, from + cap);
    return { data: rows.slice(from, end), error: null };
  };
  return { page, calls };
}

describe("fetchAllRows", () => {
  it("reads every row past the 1000-row cap", async () => {
    const { page, calls } = fakeTable(2345);
    const { data, error } = await fetchAllRows(page);
    expect(error).toBeNull();
    expect(data).toHaveLength(2345);
    expect(data[2344]).toEqual({ id: 2344 });
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [2345, 3344],
    ]);
  });

  it("returns nothing for an empty table in one call", async () => {
    const { page, calls } = fakeTable(0);
    const { data } = await fetchAllRows(page);
    expect(data).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("still gets every row when the server cap is below the page size", async () => {
    const { page } = fakeTable(1200, 500);
    const { data } = await fetchAllRows(page);
    expect(data).toHaveLength(1200);
    expect(new Set(data.map((r) => r.id)).size).toBe(1200);
  });

  it("stops and reports an error, keeping rows read so far", async () => {
    let n = 0;
    const page = async (from: number) => {
      n += 1;
      if (n === 2) return { data: null, error: { message: "boom" } };
      return { data: [{ id: from }], error: null };
    };
    const { data, error } = await fetchAllRows(page, { pageSize: 1 });
    expect(error).toBe("boom");
    expect(data).toEqual([{ id: 0 }]);
  });

  it("stops at maxRows", async () => {
    const page = async (from: number, to: number) => ({
      data: Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })),
      error: null,
    });
    const { data } = await fetchAllRows(page, { pageSize: 10, maxRows: 30 });
    expect(data).toHaveLength(30);
  });
});
