import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sandbox } from "../../test/cases-runner.mjs";

const BIN = path.join(import.meta.dirname, "..", "..", "bin", "docrank.mjs");
const boxes = [];
afterEach(() => boxes.splice(0).forEach((b) => b.cleanup()));

/** A repository whose remote holds `develop` one commit past the local `main`. */
function repoWithRemote(config) {
  const box = sandbox({ config });
  boxes.push(box);
  const remote = path.join(box.dir, "origin.git");
  box.git(box.dir, "init", "-q", "--bare", remote);
  box.git(box.repo, "remote", "add", "origin", remote);
  box.git(box.repo, "checkout", "-q", "-b", "develop");
  writeFileSync(path.join(box.repo, "dev.txt"), "on develop");
  box.git(box.repo, "add", "dev.txt");
  box.git(box.repo, "commit", "-qm", "dev");
  box.git(box.repo, "push", "-q", "origin", "develop");
  box.git(box.repo, "checkout", "-q", "main");
  box.git(box.repo, "branch", "-D", "develop");
  return box;
}


/** Gives the remote a `batch/shared` branch that holds `batch.txt` and not what develop holds. */
function withSharedBranch(box) {
  box.git(box.repo, "checkout", "-q", "-b", "batch/shared", "main");
  writeFileSync(path.join(box.repo, "batch.txt"), "shared");
  box.git(box.repo, "add", "batch.txt");
  box.git(box.repo, "commit", "-qm", "shared");
  box.git(box.repo, "push", "-q", "origin", "batch/shared");
  box.git(box.repo, "checkout", "-q", "main");
  box.git(box.repo, "branch", "-D", "batch/shared");
}

const run = (cwd, ...args) => spawnSync(process.execPath, [BIN, "worktree", ...args], { cwd, encoding: "utf8" });

describe("docrank worktree", () => {
  const config = { branches: { integration: "develop" }, worktree: { install: "echo installed > installed.txt" } };

  it("cuts the branch from the fetched integration branch and prints the directory alone", () => {
    const box = repoWithRemote(config);
    const r = run(box.repo, "fix/where-to-look");
    expect(r.status, r.stderr).toBe(0);
    const dir = r.stdout.trim();
    expect(dir).toBe(path.join(box.dir, "repo-where-to-look"));
    expect(existsSync(path.join(dir, "dev.txt"))).toBe(true);
    expect(box.git(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("fix/where-to-look");
    expect(() => box.git(dir, "rev-parse", "--abbrev-ref", "@{upstream}")).toThrow();
  });

  it("copies worktree.copy where present and runs worktree.install in the worktree", () => {
    const box = repoWithRemote(config);
    writeFileSync(path.join(box.repo, ".env"), "SECRET=1");
    const dir = run(box.repo, "feat/x").stdout.trim();
    expect(readFileSync(path.join(dir, ".env"), "utf8")).toBe("SECRET=1");
    expect(existsSync(path.join(dir, ".mcp.json"))).toBe(false);
    expect(readFileSync(path.join(dir, "installed.txt"), "utf8").trim()).toBe("installed");
  });

  it("reopens a worktree that exists, and checks out a branch that exists", () => {
    const box = repoWithRemote(config);
    const first = run(box.repo, "feat/again").stdout.trim();
    expect(run(box.repo, "feat/again").stdout.trim()).toBe(first);
    box.git(box.repo, "branch", "kept", "main");
    const dir = run(box.repo, "kept").stdout.trim();
    expect(box.git(dir, "rev-parse", "HEAD")).toBe(box.git(box.repo, "rev-parse", "main"));
  });

  it("fails with exit 1 and a message with no branch, outside a repository and on an unusable config", () => {
    const box = repoWithRemote(config);
    const none = run(box.repo);
    expect(none.status).toBe(1);
    expect(none.stderr).toContain("usage: docrank worktree <branch> [<base>]");
    const outside = run(box.dir, "feat/y");
    expect(outside.status).toBe(1);
    expect(outside.stderr).toContain("not in a git repository");
    writeFileSync(path.join(box.repo, ".claude", "docrank.json"), '{"worktree":{"install":3}}');
    const bad = run(box.repo, "feat/z");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("worktree.install");
  });

  it("fetches the base it is given and cuts from it, not from the integration branch", () => {
    const box = repoWithRemote(config);
    withSharedBranch(box);
    const r = run(box.repo, "feat/slice", "batch/shared");
    expect(r.status, r.stderr).toBe(0);
    const dir = r.stdout.trim();
    expect(existsSync(path.join(dir, "batch.txt"))).toBe(true);
    expect(existsSync(path.join(dir, "dev.txt"))).toBe(false);
    expect(box.git(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("feat/slice");
    expect(() => box.git(dir, "rev-parse", "--abbrev-ref", "@{upstream}")).toThrow();
  });

  it("fails, creating nothing, when the base cannot be fetched", () => {
    const box = repoWithRemote(config);
    const r = run(box.repo, "feat/slice", "no-such-base");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("cannot fetch origin/no-such-base");
    expect(existsSync(path.join(box.dir, "repo-slice"))).toBe(false);
  });

  it("refuses a third argument", () => {
    const box = repoWithRemote(config);
    expect(run(box.repo, "feat/a", "b", "c").status).toBe(1);
  });
});
