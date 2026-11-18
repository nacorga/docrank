import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sandbox } from "../../test/cases-runner.mjs";

const BIN = path.join(import.meta.dirname, "..", "..", "bin", "docrank.mjs");
const boxes = [];
afterEach(() => boxes.splice(0).forEach((b) => b.cleanup()));

function repoWith(config, files = {}) {
  const box = sandbox({ config });
  boxes.push(box);
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(box.repo, f)), { recursive: true });
    writeFileSync(path.join(box.repo, f), text);
  }
  return box.repo;
}
const docrank = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });

describe("docrank check", () => {
  it("is off while its key is empty", () => {
    const r = docrank(repoWith({}), "check", "sections");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("sections: off");
  });

  it("passes when every reference names a heading, and fails naming the one that does not", () => {
    const config = { docs: { scanRoots: ["docs"] } };
    const ok = docrank(repoWith(config, { "docs/a.md": "# A\n\n## Real\n", "docs/b.md": "See a.md § Real.\n" }), "check", "sections");
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("every reference names a heading");
    const bad = docrank(repoWith(config, { "docs/a.md": "# A\n\n## Real\n", "docs/b.md": "See a.md § Gone.\n" }), "check", "sections");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("docs/b.md: docs/a.md § gone");
  });

  it("runs drift-pairs, failing on a unit with no pair", () => {
    const r = docrank(repoWith({ docs: { unitRoots: ["src"] } }, { "src/thing.mjs": "" }), "check", "drift-pairs");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("src/thing.mjs: no docDrift.entries pair");
  });

  it("refuses an unknown check", () => {
    const r = docrank(repoWith({}), "check", "nope");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage: docrank check <sections|drift-pairs>");
  });
});
