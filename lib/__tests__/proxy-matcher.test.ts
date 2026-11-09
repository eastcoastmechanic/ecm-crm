import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every staff page lives in app/(internal)/<folder>. The proxy is what checks the
// sign-in and sets the staff role header, so a folder missing from its matcher is
// a page with no sign-in check (and a role header nobody overwrites). This test
// fails when a new internal folder is added without a matcher entry.
const root = process.cwd();
const internalDir = join(root, "app", "(internal)");
const proxySource = readFileSync(join(root, "proxy.ts"), "utf8");

const routeFolders = readdirSync(internalDir).filter((name) => {
  if (name.startsWith("_") || name.startsWith("(")) return false;
  return statSync(join(internalDir, name)).isDirectory();
});

describe("proxy matcher covers every internal page", () => {
  it("finds the internal route folders", () => {
    expect(routeFolders.length).toBeGreaterThan(10);
  });

  for (const folder of routeFolders) {
    it(`/${folder} is in the matcher`, () => {
      expect(proxySource).toContain(`"/${folder}"`);
      expect(proxySource).toContain(`"/${folder}/:path*"`);
    });
  }
});
