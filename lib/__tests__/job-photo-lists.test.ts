import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as { photos: { path?: string; url?: string | null }[]; opts: unknown }[] }));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/lib/photo-urls", () => ({
  signStoredPhotos: async (photos: { path?: string; url?: string | null }[], opts: unknown) => {
    h.calls.push({ photos, opts });
    return photos.map((p) => ({ ...p, url: p.path ? `signed:${p.path}` : (p.url ?? null) }));
  },
}));

import { resolveJobPhotoLists } from "../job-photos";

beforeEach(() => {
  h.calls = [];
});

describe("resolveJobPhotoLists", () => {
  it("signs every job's photos in one call and hands each job back its own", async () => {
    const result = await resolveJobPhotoLists([
      [{ path: "a.jpg", caption: null, url: null }],
      null,
      [],
      [
        { path: "b.jpg", caption: "x", url: null },
        { url: "https://elsewhere.test/c.jpg", caption: null },
      ],
      "not an array",
    ]);

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].opts).toEqual({ defaultBucket: "job-photos" });
    expect(result.map((list) => list.map((p) => p.url))).toEqual([
      ["signed:a.jpg"],
      [],
      [],
      ["signed:b.jpg", "https://elsewhere.test/c.jpg"],
      [],
    ]);
  });

  it("makes no signing call when no job has photos", async () => {
    const result = await resolveJobPhotoLists([null, [], undefined]);
    expect(h.calls).toHaveLength(0);
    expect(result).toEqual([[], [], []]);
  });
});
