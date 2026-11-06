import { describe, expect, it } from "vitest";
import { clientIp, loginLocked, redirectHost, registrationAllowed } from "../oauth-limits";

// Counts include the request being handled (it's recorded before counting).

describe("registrationAllowed", () => {
  it("allows up to 5 an hour, the 6th is refused", () => {
    expect(registrationAllowed(1)).toBe(true);
    expect(registrationAllowed(5)).toBe(true);
    expect(registrationAllowed(6)).toBe(false);
  });

  it("refuses when the count is unknown", () => {
    expect(registrationAllowed(null)).toBe(false);
  });
});

describe("loginLocked", () => {
  it("lets one address fail 5 times, then locks the 6th try", () => {
    expect(loginLocked({ ipAttempts: 5, allAttempts: 5 })).toBe(false);
    expect(loginLocked({ ipAttempts: 6, allAttempts: 6 })).toBe(true);
  });

  it("locks everyone after 20 failures spread across addresses", () => {
    expect(loginLocked({ ipAttempts: 1, allAttempts: 20 })).toBe(false);
    expect(loginLocked({ ipAttempts: 1, allAttempts: 21 })).toBe(true);
  });

  it("locks when the counts can't be read", () => {
    expect(loginLocked({ ipAttempts: null, allAttempts: 1 })).toBe(true);
  });
});

describe("redirectHost and clientIp", () => {
  it("shows the host a connection sends access to", () => {
    expect(redirectHost("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(redirectHost("not a url")).toBe("an unknown site");
  });

  it("takes the first forwarded address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
