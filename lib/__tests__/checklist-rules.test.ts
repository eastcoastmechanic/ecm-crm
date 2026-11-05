import { describe, expect, it } from "vitest";
import { finishBlockers, type ChecklistItem } from "../checklist-rules";

const item = (label: string, done: boolean, required = true): ChecklistItem => ({ id: label, label, required, done });

describe("finishBlockers", () => {
  it("lets a finished checklist with a photo through", () => {
    expect(finishBlockers({ items: [item("a", true), item("b", true)], photoCount: 1, unlocked: false })).toEqual([]);
  });

  it("blocks an open required item and names it", () => {
    const out = finishBlockers({ items: [item("Clean up", false)], photoCount: 2, unlocked: false });
    expect(out).toEqual(["Checklist item not done: Clean up"]);
  });

  it("counts several open items", () => {
    const out = finishBlockers({ items: [item("a", false), item("b", false), item("c", true)], photoCount: 1, unlocked: false });
    expect(out[0]).toContain("2 checklist items not done");
  });

  it("ignores optional items", () => {
    expect(finishBlockers({ items: [item("a", false, false)], photoCount: 1, unlocked: false })).toEqual([]);
  });

  it("needs a photo", () => {
    expect(finishBlockers({ items: [item("a", true)], photoCount: 0, unlocked: false })).toEqual(["Add at least one job photo."]);
  });

  it("reports both problems at once", () => {
    expect(finishBlockers({ items: [item("a", false)], photoCount: 0, unlocked: false })).toHaveLength(2);
  });

  it("an owner unlock lets it through", () => {
    expect(finishBlockers({ items: [item("a", false)], photoCount: 0, unlocked: true })).toEqual([]);
  });

  it("a job with no checklist is gated on the photo only", () => {
    expect(finishBlockers({ items: [], photoCount: 0, unlocked: false })).toEqual(["Add at least one job photo."]);
    expect(finishBlockers({ items: [], photoCount: 1, unlocked: false })).toEqual([]);
  });
});
