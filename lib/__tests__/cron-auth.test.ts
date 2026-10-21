import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cronAuthorized } from "../cron-auth";

function req(authorization?: string) {
  return new Request("https://example.test/api/cron/x", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("cronAuthorized", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("fails closed when CRON_SECRET is unset, including for 'Bearer undefined'", () => {
    expect(cronAuthorized(req("Bearer undefined"))).toBe(false);
    expect(cronAuthorized(req("Bearer "))).toBe(false);
    expect(cronAuthorized(req())).toBe(false);
  });

  it("accepts the correct bearer token", () => {
    process.env.CRON_SECRET = "test-secret";
    expect(cronAuthorized(req("Bearer test-secret"))).toBe(true);
  });

  it("rejects a wrong token, a wrong scheme, and a missing header", () => {
    process.env.CRON_SECRET = "test-secret";
    expect(cronAuthorized(req("Bearer test-secreT"))).toBe(false);
    expect(cronAuthorized(req("Bearer nope"))).toBe(false);
    expect(cronAuthorized(req("test-secret"))).toBe(false);
    expect(cronAuthorized(req())).toBe(false);
  });
});
