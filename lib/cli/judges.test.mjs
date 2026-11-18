import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sandbox } from "../../test/cases-runner.mjs";
import { routesFor } from "./judges.mjs";

const BIN = path.join(import.meta.dirname, "..", "..", "bin", "docrank.mjs");
const config = {
  branches: { integration: "develop" },
  judges: {
    routes: [
      { agent: "spec-arbiter", ground: ["**"] },
      { agent: "surface-reviewer", ground: ["apps/web/src/**", "DESIGN.md"] },
      { agent: "db-judge", ground: ["db/*.sql"] },
    ],
  },
};
const boxes = [];
afterEach(() => boxes.splice(0).forEach((b) => b.cleanup()));

/** A branch off origin/develop that changed `files`, the last one left uncommitted. */
function branchChanging(files, cfg = config) {
  const box = sandbox({ config: cfg });
  boxes.push(box);
  box.git(box.repo, "update-ref", "refs/remotes/origin/develop", "HEAD");
  box.git(box.repo, "switch", "-q", "-c", "feat/x");
  const write = (f) => {
    mkdirSync(path.dirname(path.join(box.repo, f)), { recursive: true });
    writeFileSync(path.join(box.repo, f), "x");
  };
  files.slice(0, -1).forEach(write);
  box.git(box.repo, "add", ".");
  if (files.length > 1) box.git(box.repo, "commit", "-qm", "change");
  write(files.at(-1));
  return box;
}
const docrank = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });

describe("docrank judges", () => {
  it("launches the judges whose ground the branch touches, and skips the rest", () => {
    const box = branchChanging(["apps/web/src/a.tsx", "notes.md"]);
    const { stdout, status } = docrank(box.repo, "judges");
    expect(status).toBe(0);
    expect(stdout).toContain("- `spec-arbiter` — launch: `apps/web/src/a.tsx`, `notes.md`.");
    expect(stdout).toContain("- `surface-reviewer` — launch: `apps/web/src/a.tsx`.");
    expect(stdout).toContain("- `db-judge` — skip: touches none of `db/*.sql`.");
  });

  it("reads a range alone, for the re-check after a fix", () => {
    const box = branchChanging(["db/a.sql", "apps/web/src/a.tsx"]);
    box.git(box.repo, "add", ".");
    box.git(box.repo, "commit", "-qm", "fix");
    const { stdout } = docrank(box.repo, "judges", "HEAD~1..HEAD");
    expect(stdout).toContain("# The judges for `HEAD~1..HEAD`");
    expect(stdout).toContain("- `surface-reviewer` — launch: `apps/web/src/a.tsx`.");
    // db/a.sql is in the earlier commit, outside the range.
    expect(stdout).toContain("- `db-judge` — skip");
  });

  it("prints the caller's half of the protocol, not the judge's", () => {
    const { stdout } = docrank(branchChanging(["a.md"]).repo, "judges");
    expect(stdout).toContain("## The caller");
    expect(stdout).toContain("**A round** waits for every judge launched in it");
    expect(stdout).not.toContain("A first pass is the whole review");
  });

  it("says so when nothing changed or no route is configured", () => {
    const box = sandbox({ config });
    boxes.push(box);
    box.git(box.repo, "update-ref", "refs/remotes/origin/develop", "HEAD");
    expect(docrank(box.repo, "judges").stdout).toContain("Nothing changed: no judge to launch.");
    const bare = branchChanging(["a.md"], { branches: { integration: "develop" } });
    expect(docrank(bare.repo, "judges").stdout).toContain("`judges.routes` is empty");
  });

  it("fails naming the problem on a bad range, an unusable config or no integration branch", () => {
    const box = branchChanging(["a.md"]);
    expect(docrank(box.repo, "judges", "nope..HEAD")).toMatchObject({ status: 1 });
    expect(docrank(box.repo, "judges", "nope..HEAD").stderr).toContain("is `nope..HEAD` a ref here?");
    const noBase = sandbox({ config });
    boxes.push(noBase);
    expect(docrank(noBase.repo, "judges").stderr).toContain("no integration branch");
    writeFileSync(path.join(box.repo, ".claude", "docrank.json"), '{"judges":{"maxRechecks":0}}');
    expect(docrank(box.repo, "judges").stderr).toContain("judges.maxRechecks");
  });
});

describe("routesFor", () => {
  it("matches `*` within a directory and `**` across them", () => {
    const [one, deep] = routesFor(
      [
        { agent: "a", ground: ["db/*.sql"] },
        { agent: "b", ground: ["db/**"] },
      ],
      ["db/x.sql", "db/sub/y.sql"],
    );
    expect(one.files).toEqual(["db/x.sql"]);
    expect(deep.files).toEqual(["db/x.sql", "db/sub/y.sql"]);
  });
});

describe("the docrank command", () => {
  it("lists its subcommands for a name it does not have, and runs none", () => {
    for (const args of [[], ["nope"], ["../x"]]) {
      const r = docrank(process.cwd(), ...args);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/^Usage: docrank <check|judges>/);
    }
  });
});
