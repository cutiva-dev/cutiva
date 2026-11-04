import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// CommonJS apps (NestJS, plain Node) load the ESM build with require() on Node 20.19+ and 22.12+,
// which needs a "default" export condition. Runs against dist/, so `npm run build` comes first.
describe("package", () => {
  it("loads with require() from CommonJS", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const out = execFileSync(process.execPath, ["-e", "const c = require('@cutiva/core'); console.log(typeof c.planReframe)"], { cwd: root, encoding: "utf8" });
    expect(out.trim()).toBe("function");
  });
});
