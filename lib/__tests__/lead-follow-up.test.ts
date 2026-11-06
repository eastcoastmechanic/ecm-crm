import { describe, expect, it } from "vitest";
import { followUpState, shortDate } from "../lead-follow-up";

describe("followUpState", () => {
  const today = "2026-11-10";

  it("flags overdue, today and upcoming follow-ups on open leads", () => {
    expect(followUpState("2026-11-09", "contacted", today)).toBe("overdue");
    expect(followUpState("2026-11-10", "new", today)).toBe("today");
    expect(followUpState("2026-11-11", "quoted", today)).toBe("upcoming");
  });

  it("never flags a closed lead or a lead with no date", () => {
    expect(followUpState("2026-11-01", "won", today)).toBe("none");
    expect(followUpState("2026-11-01", "lost", today)).toBe("none");
    expect(followUpState("2026-11-01", "dismissed", today)).toBe("none");
    expect(followUpState(null, "new", today)).toBe("none");
  });
});

describe("shortDate", () => {
  it("prints the calendar date without shifting a day", () => {
    expect(shortDate("2026-11-10")).toBe("Nov 10");
    expect(shortDate("2026-01-01")).toBe("Jan 1");
  });
});
