import { describe, expect, it } from "vitest";
import { appointmentReminder, one, type ReminderJobRow } from "../appointment-reminder";

const customer = { name: "Test Customer", phone: "508-555-0100", sms_consent: true };

function row(overrides: Partial<ReminderJobRow>): ReminderJobRow {
  return {
    scheduled_at: "2026-10-27T13:30:00.000Z", // Tue 9:30 AM New York (EDT)
    customers: customer,
    properties: { address: "1 Main St" },
    ...overrides,
  };
}

describe("appointmentReminder", () => {
  it("sends when the customer comes back as an object (many-to-one)", () => {
    const decision = appointmentReminder(row({}));
    expect(decision).toEqual({
      send: true,
      phone: "508-555-0100",
      body: "East Coast Mechanical: reminder — you're scheduled for Tue 9:30 AM at 1 Main St. Reply STOP to opt out.",
    });
  });

  it("also accepts the customer and property as arrays", () => {
    const decision = appointmentReminder(row({ customers: [customer], properties: [{ address: "1 Main St" }] }));
    expect(decision.send).toBe(true);
  });

  it("never texts without sms_consent", () => {
    expect(appointmentReminder(row({ customers: { ...customer, sms_consent: false } }))).toEqual({
      send: false,
      reason: "no sms consent",
    });
    expect(appointmentReminder(row({ customers: { ...customer, sms_consent: null } }))).toEqual({
      send: false,
      reason: "no sms consent",
    });
  });

  it("skips jobs with no customer or no phone", () => {
    expect(appointmentReminder(row({ customers: null }))).toEqual({ send: false, reason: "no customer" });
    expect(appointmentReminder(row({ customers: { ...customer, phone: null } }))).toEqual({
      send: false,
      reason: "no phone",
    });
  });

  it("leaves the address out when the job has no property", () => {
    const decision = appointmentReminder(row({ properties: null }));
    expect(decision.send && decision.body).toBe(
      "East Coast Mechanical: reminder — you're scheduled for Tue 9:30 AM. Reply STOP to opt out."
    );
  });
});

describe("one", () => {
  it("unwraps arrays and passes objects through", () => {
    expect(one([1, 2])).toBe(1);
    expect(one({ a: 1 })).toEqual({ a: 1 });
    expect(one([])).toBeNull();
    expect(one(null)).toBeNull();
  });
});
