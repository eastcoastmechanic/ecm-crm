import { describe, expect, it } from "vitest";
import {
  buildPushPayload,
  isAllowedPushEndpoint,
  isGoneStatus,
  normalizeVapidSubject,
  parseSubscription,
} from "../push-rules";

describe("normalizeVapidSubject", () => {
  it("keeps a proper mailto: or https: subject as is", () => {
    expect(normalizeVapidSubject("mailto:office@example.com")).toBe("mailto:office@example.com");
    expect(normalizeVapidSubject("https://example.com")).toBe("https://example.com");
    expect(normalizeVapidSubject("https://example.com/contact")).toBe("https://example.com/contact");
  });
  it("adds mailto: to a bare email address", () => {
    expect(normalizeVapidSubject("office@example.com")).toBe("mailto:office@example.com");
  });
  it("adds https:// to a bare host", () => {
    expect(normalizeVapidSubject("example.com")).toBe("https://example.com");
    expect(normalizeVapidSubject("example.com:443")).toBe("https://example.com:443");
  });
  it("trims spaces, quotes and line breaks pasted with the value", () => {
    expect(normalizeVapidSubject('  "office@example.com"\n')).toBe("mailto:office@example.com");
  });
  it("returns null for values web-push would reject", () => {
    expect(normalizeVapidSubject(undefined)).toBeNull();
    expect(normalizeVapidSubject("")).toBeNull();
    expect(normalizeVapidSubject("   ")).toBeNull();
    expect(normalizeVapidSubject("http://example.com")).toBeNull();
    expect(normalizeVapidSubject("ftp://example.com")).toBeNull();
    expect(normalizeVapidSubject("mailto:")).toBeNull();
    expect(normalizeVapidSubject("mailto:nobody")).toBeNull();
    expect(normalizeVapidSubject("office@")).toBeNull();
    expect(normalizeVapidSubject("localhost")).toBeNull();
    expect(normalizeVapidSubject("East Coast Mechanical")).toBeNull();
  });
});

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
    expect(parseSubscription({ ...good, endpoint: "https://attacker.example/x" })).toBeNull();
    expect(parseSubscription({ endpoint: good.endpoint, keys: { p256dh: "k" } })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription("x")).toBeNull();
  });
});

describe("isAllowedPushEndpoint", () => {
  it("accepts the real browser push services", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-par02p.notify.windows.com/?token=abc")).toBe(true);
  });
  it("rejects other hosts, look-alikes, ports and credentials", () => {
    expect(isAllowedPushEndpoint("https://attacker.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://evilnotify.windows.com.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://u:p@fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
  });
});
