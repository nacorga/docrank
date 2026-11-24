import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkSections } from "./check-sections.mjs";
import { PLUGIN_ROOT } from "./agent-types.mjs";
import { project } from "./testing.mjs";

const docs = {
  "docs/guide.md": "# Guide\n\n## Install the tool\n\nText.\n\n## Limits — what it refuses\n\n- **Rate limit.** Ten.\n",
  "docs/plans/2026-01-01-old.md": "# Old\n\n## Gone\n",
};
const check = (files, extra = {}) =>
  checkSections({
    root: project({ ...docs, ...files }),
    docs: { scanRoots: ["docs", "src"], historyRoots: ["docs/plans"], ...extra },
  });

describe("checkSections", () => {
  it("passes a reference to a heading, a short form, a bold lead-in and a list", () => {
    expect(
      check({
        "docs/a.md": "See [guide.md](./guide.md) § Install the tool.\nAnd `docs/guide.md` § Limits, and guide.md §§ Install the tool and Rate limit.\n",
        "src/x.mjs": "// docs/guide.md §\n// Install the tool, wrapped\nconst x = 1;\n",
      }),
    ).toEqual([]);
  });

  it("passes the opening whole words of a heading, five characters at least", () => {
    expect(check({ "docs/a.md": "guide.md § Install, as said.\n" })).toEqual([]);
    expect(check({ "docs/a.md": "guide.md § Inst, as said.\n" })).toEqual(["docs/a.md: docs/guide.md § inst"]);
  });

  it("fails a section the document does not have, one line each", () => {
    expect(
      check({ "docs/a.md": "guide.md § Uninstall.\n", "src/x.mjs": "// [guide.md] § Quotas and more\n" }),
    ).toEqual(["docs/a.md: docs/guide.md § uninstall", "src/x.mjs: docs/guide.md § quotas and more"]);
  });

  it("fails a document the tree does not hold", () => {
    expect(check({ "docs/a.md": "missing.md § Anything.\n" })).toEqual(["docs/a.md: missing.md § anything — no such document"]);
  });

  it("fails the second item of a list that names nothing", () => {
    expect(check({ "docs/a.md": "guide.md §§ Install the tool and Uninstall.\n" })).toEqual(["docs/a.md: docs/guide.md § uninstall"]);
  });

  it("neither scans history nor holds a reference to it", () => {
    expect(
      check({
        "docs/plans/2026-02-02-new.md": "guide.md § Nothing here.\n",
        "docs/a.md": "plans/2026-01-01-old.md § Whatever.\n2026-03-03-deleted.md § Whatever.\n",
        "docs/plans/2026-03-03-deleted.md": "# Kept to name it\n",
      }),
    ).toEqual([]);
  });

  it("ignores a § with no section after it, and a heading inside a fence", () => {
    expect(check({ "docs/a.md": "The guide.md § sign.\nguide.md §\n\n" })).toEqual(["docs/a.md: docs/guide.md § sign"]);
    expect(check({ "docs/a.md": "guide.md § — then nothing\n" })).toEqual([]);
    expect(check({ "docs/b.md": "```\n## Fenced\n```\n", "docs/a.md": "b.md § Fenced.\n" })).toEqual([
      "docs/a.md: docs/b.md § fenced",
    ]);
  });
});

describe("check-sections.mjs as a command", () => {
  const run = (dir) => {
    try {
      return { status: 0, out: execFileSync(process.execPath, [path.join(PLUGIN_ROOT, "lib/check-sections.mjs")], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: "utf8" }) };
    } catch (e) {
      return { status: e.status, out: e.stdout };
    }
  };
  const config = { docs: { scanRoots: ["docs"] } };

  it("exits 1 with one line per failure", () => {
    const r = run(project({ ...docs, "docs/a.md": "guide.md § Nope.\nguide.md § Nada.\n", ".claude/stickler.json": JSON.stringify(config) }));
    expect(r).toEqual({ status: 1, out: "docs/a.md: docs/guide.md § nope\ndocs/a.md: docs/guide.md § nada\n" });
  });

  it("exits 0 when every reference holds, and says it is off with no scan roots", () => {
    expect(run(project({ ...docs, ".claude/stickler.json": JSON.stringify(config) })).status).toBe(0);
    expect(run(project(docs)).out).toMatch(/off, docs\.scanRoots is empty/u);
  });

  it("exits 1 on a config that does not validate", () => {
    const r = run(project({ ".claude/stickler.json": JSON.stringify({ docs: { scanRoots: "docs" } }) }));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/docs\.scanRoots: expected an array/u);
  });

  it("holds the plugin's own documents", () => {
    expect(checkSections({ root: PLUGIN_ROOT, docs: { scanRoots: ["README.md", "docs", "agents", "skills"], historyRoots: ["docs/plans"] } })).toEqual([]);
  });
});
