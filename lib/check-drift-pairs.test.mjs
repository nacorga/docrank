import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkDriftPairs, codeUnits } from "./check-drift-pairs.mjs";
import { PLUGIN_ROOT } from "./agent-types.mjs";
import { project } from "./testing.mjs";

const tree = {
  "packages/a/src/index.ts": "",
  "packages/a/src/index.test.ts": "",
  "packages/a/src/parse/x.ts": "",
  "packages/a/src/.hidden": "",
  "packages/b/src/types.d.ts": "",
  "packages/b/src/run.ts": "",
  "packages/b/src/node_modules/x/i.js": "",
  "packages/c/README.md": "",
  "docs/a.md": "",
};
const check = (docDrift, unitRoots = ["packages/*/src"]) =>
  checkDriftPairs({ root: project(tree), docs: { unitRoots }, docDrift: { entries: [], unpaired: {}, ...docDrift } });

describe("checkDriftPairs", () => {
  it("finds each directory and source file under every root a `*` names", () => {
    expect(codeUnits(project(tree), ["packages/*/src"])).toEqual([
      "packages/a/src/index.ts",
      "packages/a/src/parse",
      "packages/b/src/run.ts",
    ]);
  });

  it("passes when every unit has a pair or a reason", () => {
    expect(
      check({
        entries: [{ code: ["packages/a/src/"], docs: ["docs/a.md"] }],
        unpaired: { "packages/b/src/run.ts": "a script" },
      }),
    ).toEqual([]);
  });

  it("fails each unit with neither, one line each", () => {
    expect(check({ entries: [{ code: ["packages/a/src/parse"], docs: ["docs/a.md"] }] })).toEqual([
      "packages/a/src/index.ts: no docDrift.entries pair and no docDrift.unpaired reason",
      "packages/b/src/run.ts: no docDrift.entries pair and no docDrift.unpaired reason",
    ]);
  });

  it("fails an entry path the tree does not hold", () => {
    expect(check({ entries: [{ code: ["packages/"], docs: ["docs/gone.md"] }] })).toEqual([
      "docs/gone.md: named in docDrift.entries, not in the tree",
    ]);
  });

  it("fails an exception that excuses nothing", () => {
    expect(check({ entries: [{ code: ["packages/"], docs: ["docs/a.md"] }], unpaired: { "packages/a/src": "why" } })).toEqual([
      "packages/a/src: docDrift.unpaired excuses no unpaired unit; drop it",
    ]);
  });

  it("reads a plain root and skips one the tree does not hold", () => {
    expect(check({}, ["packages/a/src", "nowhere"])).toHaveLength(2);
  });
});

describe("checkDriftPairs: a prefix and a unit's boundary", () => {
  const files = { "src/payments/x.ts": "", "src/payments/stripe/y.ts": "", "src/payroll.ts": "", "docs/p.md": "" };
  const check = (docDrift) =>
    checkDriftPairs({ root: project(files), docs: { unitRoots: ["src"] }, docDrift: { entries: [], unpaired: {}, ...docDrift } });
  const pair = (...code) => ({ code, docs: ["docs/p.md"] });
  const unpairedLine = (unit) => `${unit}: no docDrift.entries pair and no docDrift.unpaired reason`;

  it("pairs a directory unit with an entry written with a trailing slash", () => {
    expect(check({ entries: [pair("src/payments/")], unpaired: { "src/payroll.ts": "a script" } })).toEqual([]);
  });

  it("excuses a directory unit with an unpaired key written with a trailing slash", () => {
    expect(check({ unpaired: { "src/payments/": "generated", "src/payroll.ts": "a script" } })).toEqual([]);
  });

  it("pairs a unit with an entry naming its parent, and a file unit with its own path", () => {
    expect(check({ entries: [pair("src/", "src/payroll.ts")] })).toEqual([]);
    expect(check({ entries: [pair("src/payroll.ts")] })).toEqual([unpairedLine("src/payments")]);
  });

  it("keeps the prefix semantics: `src/pay` covers `src/payments`, `src/pay/` does not", () => {
    expect(check({ unpaired: { "src/pay": "generated" } })).toEqual([]);
    expect(check({ entries: [pair("src/payroll.ts")], unpaired: { "src/pay/": "why" } })).toEqual([
      unpairedLine("src/payments"),
      "src/pay/: docDrift.unpaired excuses no unpaired unit; drop it",
    ]);
  });

  it("does not pair a unit with an entry naming only a child of it", () => {
    expect(check({ entries: [pair("src/payments/stripe/", "src/payroll.ts")] })).toEqual([unpairedLine("src/payments")]);
  });

  it("refuses an unpaired key with a trailing slash once its unit is paired", () => {
    expect(check({ entries: [pair("src/")], unpaired: { "src/payments/": "why" } })).toEqual([
      "src/payments/: docDrift.unpaired excuses no unpaired unit; drop it",
    ]);
  });
});

describe("check-drift-pairs.mjs as a command", () => {
  const run = (config) => {
    const dir = project({ ...tree, ".claude/stickler.json": JSON.stringify(config) });
    try {
      return { status: 0, out: execFileSync(process.execPath, [path.join(PLUGIN_ROOT, "lib/check-drift-pairs.mjs")], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: "utf8" }) };
    } catch (e) {
      return { status: e.status, out: e.stdout };
    }
  };

  it("exits 1 with one line per failure, 0 when paired, and is off with no unit roots", () => {
    expect(run({ docs: { unitRoots: ["packages/b/src"] } })).toEqual({
      status: 1,
      out: "packages/b/src/run.ts: no docDrift.entries pair and no docDrift.unpaired reason\n",
    });
    expect(run({ docs: { unitRoots: ["packages/b/src"] }, docDrift: { entries: [{ code: ["packages/b/"], docs: ["docs/a.md"] }] } }).status).toBe(0);
    expect(run({}).out).toMatch(/off, docs\.unitRoots is empty/u);
  });
});

describe("stickler check drift-pairs", () => {
  it("exits 0 on a directory unit paired by an entry with a trailing slash", () => {
    const dir = project({
      "src/payments/x.ts": "",
      "docs/payments.md": "",
      ".claude/stickler.json": JSON.stringify({
        docs: { unitRoots: ["src"] },
        docDrift: { entries: [{ code: ["src/payments/"], docs: ["docs/payments.md"] }] },
      }),
    });
    const out = execFileSync(process.execPath, [path.join(PLUGIN_ROOT, "bin/stickler.mjs"), "check", "drift-pairs"], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: "utf8",
    });
    expect(out).toBe("drift-pairs: every unit has a pair or a reason\n");
  });
});
