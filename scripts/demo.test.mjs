import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../lib/config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const SCRIPT = path.join(here, "demo.mjs");
const EXAMPLE = path.join(ROOT, "examples", "consent");
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "docrank-demo-test-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const gitIn = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
// A HOME and XDG config with no git identity: the demo must not need the machine's.
const home = path.join(scratch, "home");
mkdirSync(home);
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: "1" };
const node = (args, cwd) => {
  const r = spawnSync(process.execPath, args, { cwd, env, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

const dir = path.join(scratch, "demo");
const repo = path.join(dir, "repo");
const worktree = path.join(dir, "repo-tracking");
const fixed = path.join(scratch, "fixed");
let built;
beforeAll(() => {
  built = node([SCRIPT, dir], scratch);
  if (built.status === 0) gitIn(repo, "worktree", "add", "-q", fixed, "demo/fixed");
});

describe("demo.mjs", () => {
  it("builds origin, the main checkout on main and the worktree on demo/tracking, with demo/fixed on top", () => {
    expect(built.stderr).toBe("");
    expect(built.status).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(["origin.git", "repo", "repo-tracking"]);
    expect(gitIn(repo, "branch", "--show-current")).toBe("main");
    expect(gitIn(worktree, "branch", "--show-current")).toBe("demo/tracking");
    const main = gitIn(repo, "rev-parse", "main");
    expect(gitIn(repo, "rev-parse", "origin/main")).toBe(main);
    expect(gitIn(path.join(dir, "origin.git"), "rev-parse", "main")).toBe(main);
    expect(gitIn(repo, "rev-parse", "demo/tracking^")).toBe(main);
    expect(gitIn(repo, "rev-parse", "demo/fixed^")).toBe(gitIn(repo, "rev-parse", "demo/tracking"));
    expect(gitIn(repo, "worktree", "list", "--porcelain")).toContain(`worktree ${worktree}\nHEAD ${gitIn(repo, "rev-parse", "demo/tracking")}\nbranch refs/heads/demo/tracking`);
    expect(gitIn(repo, "status", "--porcelain")).toBe("");
    expect(gitIn(worktree, "status", "--porcelain")).toBe("");
    expect(existsSync(path.join(repo, "changes")), "the patches would hand the judge the answer").toBe(false);
  });

  it("commits each patch as it is: demo/tracking and demo/fixed differ from their parent by it alone", () => {
    for (const [branch, patch] of [["demo/tracking", "tracking.patch"], ["demo/fixed", "fixed.patch"]]) {
      expect(gitIn(repo, "diff", `${branch}^`, branch)).toBe(readFileSync(path.join(EXAMPLE, "changes", patch), "utf8").trim());
    }
  });

  it("prints the paths, the session command with this plugin's root and the three steps", () => {
    expect(built.stdout).toContain(`docrank demo in ${dir}\n`);
    expect(built.stdout).toContain(`  cd ${worktree} && claude --plugin-dir ${ROOT}\n`);
    expect(built.stdout).toMatch(/1\. \/docrank:gates\n[\s\S]*2\. Review this branch with docrank:spec-arbiter\.\n[\s\S]*3\. Switch this worktree to demo\/fixed/u);
    expect(built.stdout).toContain(`rm -rf ${dir}\n`);
  });

  it("resolves the example's configuration in the worktree", () => {
    const config = loadConfig({ cwd: worktree });
    expect(config.root).toBe(worktree);
    expect(config.docs.precedence).toEqual(["docs/spec.md"]);
    expect(config.judges.routes).toEqual([{ agent: "docrank:spec-arbiter", ground: ["src/**"] }]);
    expect(config.gates.run).toEqual([{ name: "test", command: "node --test test/checkout.test.mjs" }]);
    // No drift pairing: its Stop hook would point the session at the spec before the arbiter is asked.
    expect(config.docDrift.entries).toEqual([]);
    const cli = node([path.join(ROOT, "bin", "docrank.mjs"), "config"], worktree);
    expect(cli.status).toBe(0);
    expect(JSON.parse(cli.stdout).root).toBe(worktree);
  });

  it("names the spec arbiter, launched on src/checkout.mjs, for the branch and for the fix's range", () => {
    for (const args of [[], ["demo/tracking..demo/fixed"]]) {
      const r = node([path.join(ROOT, "bin", "docrank.mjs"), "judges", ...args], worktree);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("- `docrank:spec-arbiter` — launch: `src/checkout.mjs`.\n");
    }
  });

  it("passes the gates on main, demo/tracking and demo/fixed, and records the worktree's commit", () => {
    for (const tree of [repo, worktree, fixed]) {
      const r = node([path.join(here, "run-gates.mjs"), "-C", tree], scratch);
      expect(r.stdout).toContain("PASS test\n");
      expect(r.status).toBe(0);
    }
    const record = path.join(repo, ".git", "docrank-gates-passed");
    expect(readFileSync(record, "utf8")).toContain(`${gitIn(worktree, "rev-parse", "HEAD")}\n`);
  });

  it("tells the story the spec forbids on demo/tracking and obeys it on demo/fixed", async () => {
    const user = { id: "u1", email: "ada@example.com" };
    const events = async (tree, consent) => {
      const { checkout } = await import(pathToFileURL(path.join(tree, "src", "checkout.mjs")).href);
      const sent = [];
      checkout([{ price: 100, qty: 1 }], user, { consent, track: (name, data) => sent.push(data) });
      return sent;
    };
    expect(await events(worktree, {})).toEqual([{ user: "u1", email: "ada@example.com", total: 100 }]);
    expect(await events(fixed, {})).toEqual([]);
    expect(await events(fixed, { analytics: "yes" })).toEqual([]);
    expect(await events(fixed, { analytics: true })).toEqual([{ user: "u1", total: 100 }]);
  });

  it("refuses a directory that exists and leaves it untouched", () => {
    const taken = path.join(scratch, "taken");
    mkdirSync(taken);
    writeFileSync(path.join(taken, "keep.txt"), "mine\n");
    const r = node([SCRIPT, taken], scratch);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${taken} exists`);
    expect(r.stdout).toBe("");
    expect(readdirSync(taken)).toEqual(["keep.txt"]);
    expect(readFileSync(path.join(taken, "keep.txt"), "utf8")).toBe("mine\n");
  });

  it("with no argument builds under a new temporary directory", () => {
    const tmp = path.join(scratch, "tmp");
    mkdirSync(tmp);
    const r = spawnSync(process.execPath, [SCRIPT], { env: { ...env, TMPDIR: tmp }, encoding: "utf8" });
    expect(r.status).toBe(0);
    const [made] = readdirSync(tmp);
    expect(made).toMatch(/^docrank-demo-/u);
    expect(readdirSync(path.join(tmp, made)).sort()).toEqual(["origin.git", "repo", "repo-tracking"]);
  });
});

describe("examples/consent", () => {
  it("takes its patches cleanly, one after the other, on a copy of itself", () => {
    const copy = path.join(scratch, "copy");
    cpSync(EXAMPLE, copy, { recursive: true, filter: (src) => !src.startsWith(path.join(EXAMPLE, "changes")) });
    gitIn(copy, "init", "-q");
    for (const patch of ["tracking.patch", "fixed.patch"]) {
      const file = path.join(EXAMPLE, "changes", patch);
      gitIn(copy, "apply", "--check", file);
      gitIn(copy, "apply", file);
    }
  });
});
