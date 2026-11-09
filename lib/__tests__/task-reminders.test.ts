import { describe, expect, it } from "vitest";
import { taskDigestLine, tasksDueByEndOfEtDay } from "../task-reminders";

// 7:15 PM ET on Nov 9 2026 is 00:15 UTC on Nov 10: the UTC day has already rolled over.
const EVENING_ET = new Date("2026-11-10T00:15:00.000Z");

describe("tasksDueByEndOfEtDay", () => {
  it("keeps a task due late tonight New York time and drops one due tomorrow", () => {
    const tasks = [
      { title: "tonight", dueDateTime: "2026-11-10T03:00:00.000Z" }, // 10 PM ET Nov 9
      { title: "tomorrow noon", dueDateTime: "2026-11-10T17:00:00.000Z" }, // noon ET Nov 10
      { title: "no date", dueDateTime: null },
      { title: "last week", dueDateTime: "2026-11-02T17:00:00.000Z" },
    ];
    expect(tasksDueByEndOfEtDay(tasks, EVENING_ET).map((t) => t.title)).toEqual(["tonight", "last week"]);
  });

  it("ends today at New York midnight in the morning too", () => {
    const morning = new Date("2026-11-09T13:00:00.000Z"); // 8 AM ET
    const tasks = [
      { title: "11pm tonight", dueDateTime: "2026-11-10T04:00:00.000Z" }, // 11 PM ET Nov 9
      { title: "1am tomorrow", dueDateTime: "2026-11-10T06:00:00.000Z" }, // 1 AM ET Nov 10
    ];
    expect(tasksDueByEndOfEtDay(tasks, morning).map((t) => t.title)).toEqual(["11pm tonight"]);
  });
});

describe("taskDigestLine", () => {
  it("prints the New York due date and marks earlier days overdue", () => {
    expect(taskDigestLine({ title: "Call back", dueDateTime: "2026-11-05T17:00:00.000Z", notes: "re: quote" }, EVENING_ET)).toBe(
      "- Call back (overdue) — due 11/5/2026: re: quote"
    );
  });

  it("does not call a task due earlier today overdue, and uses the ET date", () => {
    expect(taskDigestLine({ title: "Order part", dueDateTime: "2026-11-09T17:00:00.000Z" }, EVENING_ET)).toBe(
      "- Order part — due 11/9/2026"
    );
  });
});
