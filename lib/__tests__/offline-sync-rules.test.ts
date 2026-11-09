import { describe, expect, it } from "vitest";
import {
  clampTapTime,
  isMissingClientActionColumn,
  isUniqueViolation,
  parseSyncRequest,
  shouldSendOnWayNotice,
  staffKeyMatches,
} from "../offline-sync-rules";

const NOW = new Date("2026-11-09T18:00:00.000Z");
const ID = "11111111-2222-4333-8444-555555555555";
const JOB = "66666666-7777-4888-9999-000000000000";

describe("clampTapTime", () => {
  it("uses the phone's time for a tap made earlier today", () => {
    expect(clampTapTime("2026-11-09T15:30:00.000Z", NOW)).toBe("2026-11-09T15:30:00.000Z");
  });

  it("uses the server time for a tap in the future (phone clock ahead)", () => {
    expect(clampTapTime("2026-11-09T18:05:00.000Z", NOW)).toBe(NOW.toISOString());
  });

  it("uses the server time for a tap more than 24 hours old", () => {
    expect(clampTapTime("2026-11-08T17:59:00.000Z", NOW)).toBe(NOW.toISOString());
    expect(clampTapTime("2026-11-08T18:00:00.000Z", NOW)).toBe("2026-11-08T18:00:00.000Z");
  });

  it("uses the server time when the phone sent nothing usable", () => {
    expect(clampTapTime(null, NOW)).toBe(NOW.toISOString());
    expect(clampTapTime("not a date", NOW)).toBe(NOW.toISOString());
  });

  it("never stamps a step before the one it follows", () => {
    // Finish tapped at 15:00 by the phone's clock, but the job shows arrived at 16:00.
    expect(clampTapTime("2026-11-09T15:00:00.000Z", NOW, "2026-11-09T16:00:00.000Z")).toBe("2026-11-09T16:00:00.000Z");
    expect(clampTapTime("2026-11-09T17:00:00.000Z", NOW, "2026-11-09T16:00:00.000Z")).toBe("2026-11-09T17:00:00.000Z");
    // A floor in the future is ignored beyond now.
    expect(clampTapTime("2026-11-09T17:00:00.000Z", NOW, "2026-11-09T19:00:00.000Z")).toBe(NOW.toISOString());
  });
});

describe("parseSyncRequest", () => {
  it("accepts a step", () => {
    expect(parseSyncRequest({ clientActionId: ID, type: "arrive", jobId: JOB, createdAt: "2026-11-09T15:00:00Z" })).toEqual({
      clientActionId: ID,
      type: "arrive",
      jobId: JOB,
      createdAt: "2026-11-09T15:00:00Z",
    });
  });

  it("accepts a note and trims it", () => {
    expect(parseSyncRequest({ clientActionId: ID, type: "note", jobId: JOB, createdAt: null, payload: { body: "  Filter changed  " } })).toMatchObject({
      type: "note",
      body: "Filter changed",
    });
  });

  it("refuses bad input with a plain reason", () => {
    expect(parseSyncRequest(null)).toEqual({ error: "Bad request." });
    expect(parseSyncRequest({ clientActionId: "x", type: "arrive", jobId: JOB })).toEqual({ error: "Bad request." });
    expect(parseSyncRequest({ clientActionId: ID, type: "arrive", jobId: "" })).toEqual({ error: "Missing job." });
    expect(parseSyncRequest({ clientActionId: ID, type: "cancel", jobId: JOB })).toEqual({ error: "Bad request." });
    expect(parseSyncRequest({ clientActionId: ID, type: "note", jobId: JOB, payload: { body: "  " } })).toEqual({ error: "Write a note first." });
    expect(parseSyncRequest({ clientActionId: ID, type: "note", jobId: JOB, payload: { body: "x".repeat(4001) } })).toEqual({
      error: "Keep it under 4000 characters.",
    });
  });
});

describe("on-the-way notice", () => {
  it("goes out only if the tap is at most 30 minutes old", () => {
    expect(shouldSendOnWayNotice("2026-11-09T17:45:00.000Z", NOW)).toBe(true);
    expect(shouldSendOnWayNotice("2026-11-09T17:29:00.000Z", NOW)).toBe(false);
    // Two days old: the time stamped is clamped to now, but the notice still must not go.
    expect(shouldSendOnWayNotice("2026-11-07T17:00:00.000Z", NOW)).toBe(false);
    expect(shouldSendOnWayNotice("garbage", NOW)).toBe(false);
  });
});

describe("staffKeyMatches", () => {
  it("only the person who tapped may send it", () => {
    expect(staffKeyMatches("staff-1", "staff-1")).toBe(true);
    expect(staffKeyMatches("staff-1", "staff-2")).toBe(false);
    expect(staffKeyMatches("none", null)).toBe(true);
    expect(staffKeyMatches("staff-1", null)).toBe(false);
    expect(staffKeyMatches(undefined, "staff-1")).toBe(false);
  });
});

describe("database errors", () => {
  it("spots a repeat and a missing 0076 column", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isMissingClientActionColumn({ message: "Could not find the 'client_action_id' column of 'job_notes'", code: "PGRST204" })).toBe(true);
    expect(isMissingClientActionColumn({ message: "column job_notes.client_action_id does not exist", code: "42703" })).toBe(true);
    expect(isMissingClientActionColumn({ message: "network", code: "08006" })).toBe(false);
    expect(isMissingClientActionColumn(null)).toBe(false);
  });
});
