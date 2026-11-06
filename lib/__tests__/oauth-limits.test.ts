import { describe, expect, it } from "vitest";
import { clientIp, loginLocked, redirectHost, registrationAllowed } from "../oauth-limits";

describe("registrationAllowed", () => {
  it("allows a few per hour and refuses past the cap", () => {
    expect(registrationAllowed(0)).toBe(true);
    expect(registrationAllowed(4)).toBe(true);
    expect(registrationAllowed(5)).toBe(false);
  });

  it("refuses when the count is unknown", () => {
    expect(registrationAllowed(null)).toBe(false);
  });
});

describe("loginLocked", () => {
  it("locks one address after 5 failures", () => {
    expect(loginLocked({ ipFailures: 4, allFailures: 4 })).toBe(false);
    expect(loginLocked({ ipFailures: 5, allFailures: 5 })).toBe(true);
  });

  it("locks everyone after 20 failures spread across addresses", () => {
    expect(loginLocked({ ipFailures: 0, allFailures: 19 })).toBe(false);
    expect(loginLocked({ ipFailures: 0, allFailures: 20 })).toBe(true);
  });

  it("locks when the counts can't be read", () => {
    expect(loginLocked({ ipFailures: null, allFailures: 0 })).toBe(true);
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
