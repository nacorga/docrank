import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sandbox } from "../test/cases-runner.mjs";

const HOOK = path.join(import.meta.dirname, "worktree-create.mjs");
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

const create = (cwd, input) =>
  spawnSync(process.execPath, [HOOK], { cwd, input: JSON.stringify({ cwd, ...input }), encoding: "utf8" });
const lastLine = (r) => r.stdout.trim().split("\n").at(-1);

describe("worktree-create.mjs", () => {
  const config = { branches: { integration: "develop" }, worktree: { install: "echo installed > installed.txt" } };

  it("cuts the branch from the fetched integration branch, beside the main checkout, with no upstream", () => {
    const box = repoWithRemote(config);
    const r = create(box.repo, { name: "fix/where-to-look" });
    expect(r.status, r.stderr).toBe(0);
    const dir = lastLine(r);
    expect(dir).toBe(path.join(box.dir, "repo-where-to-look"));
    expect(existsSync(path.join(dir, "dev.txt"))).toBe(true);
    expect(box.git(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("fix/where-to-look");
    expect(() => box.git(dir, "rev-parse", "--abbrev-ref", "@{upstream}")).toThrow();
  });

  it("copies worktree.copy where present, skips what is absent, and runs worktree.install in it", () => {
    const box = repoWithRemote(config);
    writeFileSync(path.join(box.repo, ".env"), "SECRET=1");
    const dir = lastLine(create(box.repo, { name: "feat/x" }));
    expect(readFileSync(path.join(dir, ".env"), "utf8")).toBe("SECRET=1");
    expect(existsSync(path.join(dir, ".mcp.json"))).toBe(false);
    expect(readFileSync(path.join(dir, "installed.txt"), "utf8").trim()).toBe("installed");
  });

  it("keeps stdout to the path, even though install prints", () => {
    const box = repoWithRemote({ ...config, worktree: { install: "echo noise" } });
    expect(create(box.repo, { name: "feat/quiet" }).stdout.trim().split("\n")).toHaveLength(1);
  });

  it("reopens a worktree that exists, and checks out a branch that exists", () => {
    const box = repoWithRemote(config);
    const first = lastLine(create(box.repo, { name: "feat/again" }));
    expect(lastLine(create(box.repo, { name: "feat/again" }))).toBe(first);
    box.git(box.repo, "branch", "kept", "main");
    const dir = lastLine(create(box.repo, { name: "kept" }));
    expect(box.git(dir, "rev-parse", "HEAD")).toBe(box.git(box.repo, "rev-parse", "main"));
  });

  it("is named from the main checkout when the session starts in another worktree", () => {
    const box = repoWithRemote(config);
    expect(lastLine(create(box.wt, { name: "feat/from-wt" }))).toBe(path.join(box.dir, "repo-from-wt"));
  });

  it("fails the creation with no name, outside git, and on an unusable config", () => {
    const box = repoWithRemote(config);
    expect(create(box.repo, {}).status).toBe(1);
    expect(create(box.dir, { name: "feat/y" }).status).toBe(1);
    writeFileSync(path.join(box.repo, ".claude", "docrank.json"), '{"worktree":{"install":3}}');
    const r = create(box.repo, { name: "feat/z" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("worktree.install");
  });

  it("falls back to the cached remote branch when the fetch fails", () => {
    const box = repoWithRemote(config);
    box.git(box.repo, "fetch", "-q", "origin");
    box.git(box.repo, "remote", "set-url", "origin", path.join(box.dir, "gone.git"));
    const r = create(box.repo, { name: "feat/offline" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain("fetch failed");
    expect(existsSync(path.join(lastLine(r), "dev.txt"))).toBe(true);
  });

  it("cuts from a base the input names, and fetches nothing", () => {
    const box = repoWithRemote(config);
    withSharedBranch(box);
    box.git(box.repo, "fetch", "-q", "origin");
    box.git(box.repo, "remote", "set-url", "origin", path.join(box.dir, "gone.git"));
    const r = create(box.repo, { name: "feat/slice", base: "origin/batch/shared" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("fetch");
    const dir = lastLine(r);
    expect(existsSync(path.join(dir, "batch.txt"))).toBe(true);
    expect(existsSync(path.join(dir, "dev.txt"))).toBe(false);
    expect(() => box.git(dir, "rev-parse", "--abbrev-ref", "@{upstream}")).toThrow();
  });

  it("fails the creation when the base is no ref, and takes no base for a branch that exists", () => {
    const box = repoWithRemote(config);
    withSharedBranch(box);
    box.git(box.repo, "fetch", "-q", "origin");
    expect(create(box.repo, { name: "feat/lost", base: "origin/nope" }).status).toBe(1);
    box.git(box.repo, "branch", "kept", "main");
    const dir = lastLine(create(box.repo, { name: "kept", base: "origin/batch/shared" }));
    expect(existsSync(path.join(dir, "batch.txt"))).toBe(false);
  });
});
