import { describe, expect, it } from "vitest";
import {
  contactKeys,
  dedupeRecipients,
  DUPLICATE_REASON,
  emailMatchKey,
  lastCampaignForContact,
  optedOutEmailKeys,
  phoneMatchKey,
  sameContactIds,
  type Channel,
  type ContactInfo,
} from "../campaigns";

type Row = { customerId: string; name: string; channel: Channel | null; reason: string | null };
const row = (customerId: string, channel: Channel | null, reason: string | null = null): Row => ({
  customerId,
  name: customerId,
  channel,
  reason,
});

function lookup(list: ContactInfo[]) {
  const m = new Map(list.map((c) => [c.id, c]));
  return (id: string) => m.get(id);
}

describe("match keys", () => {
  it("phones match across formats on the last 10 digits", () => {
    expect(phoneMatchKey("(508) 555-0101")).toBe("5085550101");
    expect(phoneMatchKey("+1 508.555.0101")).toBe("5085550101");
    expect(phoneMatchKey("15085550101")).toBe("5085550101");
  });

  it("short or empty phones are not a key", () => {
    expect(phoneMatchKey("555-0101")).toBeNull();
    expect(phoneMatchKey("")).toBeNull();
    expect(phoneMatchKey(null)).toBeNull();
  });

  it("emails match trimmed and lowercased; junk is not a key", () => {
    expect(emailMatchKey("  Pat@Example.COM ")).toBe("pat@example.com");
    expect(emailMatchKey("none")).toBeNull();
    expect(emailMatchKey(null)).toBeNull();
  });

  it("contactKeys lists both", () => {
    expect(contactKeys({ phone: "508-555-0101", email: "A@b.com" })).toEqual(["p:5085550101", "e:a@b.com"]);
    expect(contactKeys({ phone: null, email: null })).toEqual([]);
  });
});

describe("dedupeRecipients", () => {
  it("two records with the same phone get one text", () => {
    const people = [
      { id: "a", phone: "(508) 555-0101", email: null },
      { id: "b", phone: "+15085550101", email: null },
    ];
    const out = dedupeRecipients([row("a", "sms"), row("b", "sms")], lookup(people));
    expect(out.map((r) => r.channel)).toEqual(["sms", null]);
    expect(out[1].reason).toBe(DUPLICATE_REASON);
  });

  it("two records with the same email (any case) get one email", () => {
    const people = [
      { id: "a", phone: null, email: "pat@example.com" },
      { id: "b", phone: null, email: " PAT@example.com" },
    ];
    const out = dedupeRecipients([row("a", "email"), row("b", "email")], lookup(people));
    expect(out.map((r) => r.channel)).toEqual(["email", null]);
  });

  it("a text and an email to the same person become just the text, even when the email row comes first", () => {
    const people = [
      { id: "a", phone: null, email: "pat@example.com" },
      { id: "b", phone: "5085550101", email: "pat@example.com" },
    ];
    const out = dedupeRecipients([row("a", "email"), row("b", "sms")], lookup(people));
    expect(out.map((r) => r.channel)).toEqual([null, "sms"]);
  });

  it("different people are all kept, and rows not going out are untouched", () => {
    const people = [
      { id: "a", phone: "5085550101", email: "a@example.com" },
      { id: "b", phone: "5085550102", email: "b@example.com" },
      { id: "c", phone: "5085550101", email: null },
    ];
    const out = dedupeRecipients([row("a", "sms"), row("b", "email"), row("c", null, "has an open job")], lookup(people));
    expect(out).toEqual([row("a", "sms"), row("b", "email"), row("c", null, "has an open job")]);
  });

  it("records with no phone or email key never collide", () => {
    const people = [
      { id: "a", phone: "123", email: null },
      { id: "b", phone: "123", email: null },
    ];
    const out = dedupeRecipients([row("a", "email"), row("b", "email")], lookup(people));
    expect(out.map((r) => r.channel)).toEqual(["email", "email"]);
  });

  it("keeps the list order and does not change the input", () => {
    const input = [row("a", "sms"), row("b", "sms")];
    const people = [
      { id: "a", phone: "5085550101", email: null },
      { id: "b", phone: "5085550101", email: null },
    ];
    dedupeRecipients(input, lookup(people));
    expect(input.map((r) => r.channel)).toEqual(["sms", "sms"]);
  });
});

describe("opt-outs and the 30 days cover duplicates", () => {
  it("an email unsubscribe on one record applies to every record with that email", () => {
    const set = optedOutEmailKeys([
      { email: "Pat@Example.com", email_opt_out_at: "2026-11-01T00:00:00Z" },
      { email: "kim@example.com", email_opt_out_at: null },
    ]);
    expect(set.has(emailMatchKey("pat@example.com ")!)).toBe(true);
    expect(set.has("kim@example.com")).toBe(false);
  });

  it("sameContactIds groups records by shared phone or email", () => {
    const groups = sameContactIds([
      { id: "a", phone: "5085550101", email: "a@example.com" },
      { id: "b", phone: "(508) 555-0101", email: null },
      { id: "c", phone: null, email: "A@EXAMPLE.com" },
      { id: "d", phone: "5085550199", email: "d@example.com" },
    ]);
    expect(groups.get("a")?.sort()).toEqual(["a", "b", "c"]);
    expect(groups.get("b")?.sort()).toEqual(["a", "b"]);
    expect(groups.get("d")).toEqual(["d"]);
  });

  it("a campaign to one record counts for its duplicates", () => {
    const groups = sameContactIds([
      { id: "a", phone: "5085550101", email: null },
      { id: "b", phone: "5085550101", email: null },
      { id: "c", phone: "5085550199", email: null },
    ]);
    const last = lastCampaignForContact(groups, new Map([["a", "2026-11-01T00:00:00Z"]]));
    expect(last.get("b")).toBe("2026-11-01T00:00:00Z");
    expect(last.get("c")).toBeUndefined();
  });

  it("takes the latest send across the group", () => {
    const groups = sameContactIds([
      { id: "a", phone: "5085550101", email: null },
      { id: "b", phone: "5085550101", email: null },
    ]);
    const last = lastCampaignForContact(
      groups,
      new Map([
        ["a", "2026-10-01T00:00:00Z"],
        ["b", "2026-10-20T00:00:00Z"],
      ])
    );
    expect(last.get("a")).toBe("2026-10-20T00:00:00Z");
  });
});
