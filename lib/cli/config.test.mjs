import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { sandbox } from "../../test/cases-runner.mjs";
import path from "node:path";

const BIN = path.join(import.meta.dirname, "..", "..", "cli", "stickler.mjs");
const boxes = [];
afterEach(() => boxes.splice(0).forEach((b) => b.cleanup()));
const run = (config) => {
  const box = sandbox({ config });
  boxes.push(box);
  return spawnSync(process.execPath, [BIN, "config"], { cwd: box.repo, encoding: "utf8" });
};

describe("stickler config", () => {
  it("prints the resolved config, defaults included", () => {
    const r = run({ branches: { integration: "develop" } });
    expect(r.status, r.stderr).toBe(0);
    const c = JSON.parse(r.stdout);
    expect(c.branches.integration).toBe("develop");
    expect(c.branches.allowedPrBases).toEqual(["develop"]);
    expect(c.guard.publishBan).toBe(true);
  });

  it("prints the errors naming the key and exits 1", () => {
    const r = run({ gates: { run: [{ name: "a", cmd: "x" }] } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("gates.run[0].cmd: unknown key");
  });
});
