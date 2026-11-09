import { describe, expect, it } from "vitest";
import {
  appendNoteLine,
  finishedBucket,
  jobSourceLabel,
  leadCardNotes,
  leadCardTitle,
  leadSourceLabel,
  leadStageClosesCard,
  leadStageText,
  missingCategoryNames,
  planCategories,
  STEP_BUCKET,
  statusToStep,
  stepCreatesCard,
  stepLine,
  stepText,
} from "../planner-steps";

// 2:15 PM in New York on Nov 9, 2026 (EST, UTC-5).
const AT = "2026-11-09T19:15:00Z";

describe("job step to bucket", () => {
  it("scheduled and requested go to Jobs, on the way and on site to In Progress, paid to Billed", () => {
    expect(STEP_BUCKET.requested).toBe("jobs");
    expect(STEP_BUCKET.scheduled).toBe("jobs");
    expect(STEP_BUCKET.on_way).toBe("in_progress");
    expect(STEP_BUCKET.on_site).toBe("in_progress");
    expect(STEP_BUCKET.finished).toBe("finished");
    expect(STEP_BUCKET.paid).toBe("billed");
  });

  it("invoice created and sent stay where the card is (Finished until it is paid); pause and a time change don't move it", () => {
    expect(STEP_BUCKET.invoice_created).toBeNull();
    expect(STEP_BUCKET.invoice_sent).toBeNull();
    expect(STEP_BUCKET.paused).toBeNull();
    expect(STEP_BUCKET.rescheduled).toBeNull();
  });

  it("a finished job with no service report still goes to Needs Attention, as before", () => {
    expect(finishedBucket(true)).toBe("finished");
    expect(finishedBucket(false)).toBe("needs_attention");
  });

  it("maps job statuses to steps", () => {
    expect(statusToStep("requested")).toBe("requested");
    expect(statusToStep("scheduled")).toBe("scheduled");
    expect(statusToStep("in_progress")).toBe("on_site");
    expect(statusToStep("complete")).toBe("finished");
    expect(statusToStep("completed")).toBe("finished");
    expect(statusToStep("cancelled")).toBe("cancelled");
    expect(statusToStep("canceled")).toBe("cancelled");
    expect(statusToStep("on_hold")).toBeNull();
  });

  it("invoice steps, pause and a time change never make a card", () => {
    for (const s of ["invoice_created", "invoice_sent", "paid", "paused", "rescheduled"] as const) {
      expect(stepCreatesCard(s)).toBe(false);
    }
    for (const s of ["requested", "scheduled", "on_way", "on_site", "finished"] as const) {
      expect(stepCreatesCard(s)).toBe(true);
    }
  });
});

describe("step lines", () => {
  it("dates each line in New York time", () => {
    expect(stepLine(AT, "On the way (Mike)")).toBe("11/9 2:15 PM: On the way (Mike)");
  });

  it("keeps a line to one short line", () => {
    const line = stepLine(AT, `Finished\n${"x".repeat(500)}`);
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThan(230);
  });

  it("names the tech and the New York time, never an amount", () => {
    expect(stepText("scheduled", { tech: "Mike", scheduledAt: "2026-11-10T14:00:00Z" })).toBe(
      "Scheduled for Tue 11/10 9:00 AM (Mike)"
    );
    expect(stepText("requested", { source: "Website", scheduledAt: "2026-11-10T14:00:00Z" })).toBe(
      "Requested from Website, asked for Tue 11/10 9:00 AM"
    );
    expect(stepText("on_site", { tech: "Mike" })).toBe("On site (Mike)");
    expect(stepText("paused", { tech: "Mike" })).toBe("Paused (Mike)");
    expect(stepText("invoice_created", { docNumber: "INV-0042" })).toBe("Invoice INV-0042 created");
    expect(stepText("invoice_sent")).toBe("Invoice sent");
    expect(stepText("paid", { docNumber: "INV-0042" })).toBe("Invoice INV-0042 paid");
    expect(stepText("cancelled")).toBe("Cancelled");
  });
});

describe("note trimming", () => {
  it("appends at the end", () => {
    expect(appendNoteLine("Open in CRM: x", "11/9 2:15 PM: On site")).toBe("Open in CRM: x\n11/9 2:15 PM: On site");
    expect(appendNoteLine(null, "11/9 2:15 PM: On site")).toBe("11/9 2:15 PM: On site");
    expect(appendNoteLine("a\n\n", "b")).toBe("a\nb");
  });

  it("drops the oldest dated lines first and keeps the header", () => {
    const header = "Source: Website\nOpen in CRM: x";
    const old = Array.from({ length: 10 }, (_, i) => `11/${i + 1} 9:00 AM: step ${i}`);
    const notes = [header, ...old].join("\n");
    const out = appendNoteLine(notes, "11/20 9:00 AM: newest", notes.length + 5);
    expect(out.startsWith(header)).toBe(true);
    expect(out).not.toContain("step 0");
    expect(out).toContain("step 9");
    expect(out.endsWith("11/20 9:00 AM: newest")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(notes.length + 5);
  });

  it("never goes over the limit even with no dated lines to drop", () => {
    const out = appendNoteLine("h".repeat(100), "11/20 9:00 AM: newest", 50);
    expect(out.length).toBe(50);
    expect(out.endsWith("newest")).toBe(true);
  });
});

describe("labels", () => {
  it("names the source of a lead or a web/phone request", () => {
    expect(leadSourceLabel("manual")).toBe("Manual");
    expect(leadSourceLabel("missed_contact")).toBe("Phone");
    expect(leadSourceLabel("something_new")).toBe("Other");
    expect(jobSourceLabel("web_form")).toBe("Website");
    expect(jobSourceLabel("web_chat")).toBe("Chat");
    expect(jobSourceLabel("portal")).toBe("Portal");
    expect(jobSourceLabel("ai_voice")).toBe("Phone");
    expect(jobSourceLabel("ai_sms")).toBe("Text");
    expect(jobSourceLabel("manual")).toBeNull();
    expect(jobSourceLabel("maintenance_plan")).toBeNull();
  });

  it("reuses a label that exists (any case) and never renames one", () => {
    const { applied, newNames } = planCategories({ category1: "Urgent", category4: "lead" }, new Set(), ["Lead"]);
    expect(applied).toEqual(["category4"]);
    expect(newNames).toEqual({});
  });

  it("puts a new label only on a slot with no name that no card uses", () => {
    const { applied, newNames } = planCategories(
      { category1: "Urgent", category2: "Lead", category3: "" },
      new Set(["category3", "category4"]),
      ["Lead", "Website"]
    );
    expect(applied).toEqual(["category2", "category5"]);
    expect(newNames).toEqual({ category5: "Website" });
  });

  it("skips a label when all 25 slots are taken", () => {
    const all = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`category${i + 1}`, `L${i}`]));
    expect(planCategories(all, new Set(), ["Website"])).toEqual({ applied: [], newNames: {} });
  });

  it("lists names with no slot yet", () => {
    expect(missingCategoryNames({ category2: "Lead" }, ["lead", "Website"])).toEqual(["Website"]);
  });
});

describe("lead cards", () => {
  it("titles a card with the name and a short need", () => {
    expect(leadCardTitle("Jane Smith", "No heat upstairs")).toBe("Lead: Jane Smith — No heat upstairs");
    expect(leadCardTitle("", null)).toBe("Lead: New lead");
    const long = leadCardTitle("Jane", "Furnace short cycling every few minutes and the thermostat keeps resetting itself");
    expect(long.length).toBeLessThan(70);
    expect(long.endsWith("…")).toBe(true);
  });

  it("says whether a phone or email is on file without printing them", () => {
    const notes = leadCardNotes({
      source: "manual",
      phone: "508-555-0100",
      email: "jane@example.com",
      address: "12 Main St",
      town: "Plymouth",
      message: "No heat",
      crmUrl: "https://ecm-crm.vercel.app/leads",
    });
    expect(notes).toContain("Source: Manual");
    expect(notes).toContain("Phone: on file");
    expect(notes).toContain("Email: on file");
    expect(notes).toContain("Address: 12 Main St, Plymouth");
    expect(notes).toContain("Message: No heat");
    expect(notes).toContain("Open in CRM: https://ecm-crm.vercel.app/leads");
    expect(notes).not.toContain("555");
    expect(notes).not.toContain("example.com");
  });

  it("closes the card on won, lost and dismissed", () => {
    expect(leadStageClosesCard("won")).toBe(true);
    expect(leadStageClosesCard("lost")).toBe(true);
    expect(leadStageClosesCard("dismissed")).toBe(true);
    expect(leadStageClosesCard("quoted")).toBe(false);
    expect(leadStageText("won")).toBe("Stage: Won");
  });
});
