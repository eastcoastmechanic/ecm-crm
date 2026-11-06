import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { parseSmsKeyword } from "../sms-consent";

describe("parseSmsKeyword", () => {
  it.each(["STOP", "stop", " Stop. ", "STOPALL", "unsubscribe", "Cancel", "END", "quit"])(
    "reads %j as an opt-out",
    (word) => expect(parseSmsKeyword(word)).toBe("opt_out")
  );

  it.each(["START", "start", "Unstop!"])("reads %j as an opt-in", (word) =>
    expect(parseSmsKeyword(word)).toBe("opt_in")
  );

  it("reads YES and HELP", () => {
    expect(parseSmsKeyword("Yes")).toBe("yes");
    expect(parseSmsKeyword("help?")).toBe("help");
  });

  it.each(["please stop texting me", "stop by tomorrow", "starting at 8", "", "ok thanks"])(
    "does not treat %j as a keyword",
    (text) => expect(parseSmsKeyword(text)).toBeNull()
  );
});
