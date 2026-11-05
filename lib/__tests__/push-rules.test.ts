import { describe, expect, it } from "vitest";
import { buildPushPayload, isGoneStatus, parseSubscription } from "../push-rules";

describe("buildPushPayload", () => {
  it("trims, collapses whitespace and caps length", () => {
    const p = buildPushPayload({ title: "  New   job ", body: "x".repeat(300), url: "/field-board" });
    expect(p.title).toBe("New job");
    expect(p.body).toHaveLength(180);
  });
  it("falls back to the field board for odd urls", () => {
    expect(buildPushPayload({ title: "t", body: "b", url: "javascript:alert(1)" }).url).toBe("/field-board");
    expect(buildPushPayload({ title: "t", body: "b", url: "https://ecm-crm.vercel.app/field-board" }).url).toBe(
      "https://ecm-crm.vercel.app/field-board"
    );
  });
});

describe("isGoneStatus", () => {
  it("is true only for 404 and 410", () => {
    expect(isGoneStatus(410)).toBe(true);
    expect(isGoneStatus(404)).toBe(true);
    expect(isGoneStatus(500)).toBe(false);
    expect(isGoneStatus(undefined)).toBe(false);
  });
});

describe("parseSubscription", () => {
  const good = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "k", auth: "a" } };
  it("accepts a normal browser subscription", () => {
    expect(parseSubscription(good)).toEqual({ endpoint: good.endpoint, p256dh: "k", auth: "a" });
  });
  it("rejects non-https endpoints, missing keys and junk", () => {
    expect(parseSubscription({ ...good, endpoint: "http://x" })).toBeNull();
    expect(parseSubscription({ endpoint: good.endpoint, keys: { p256dh: "k" } })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription("x")).toBeNull();
  });
});
