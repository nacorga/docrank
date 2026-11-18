import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STUBS, sandbox } from "../test/cases-runner.mjs";

const SCRIPT = path.join(import.meta.dirname, "prune-worktrees.mjs");
const boxes = [];
afterEach(() => boxes.splice(0).forEach((b) => b.cleanup()));

/** A repository with a worktree `done` holding one commit; `merged` heads are what the gh stub lists. */
function setup() {
  const box = sandbox();
  boxes.push(box);
  const dir = path.join(box.dir, "done");
  box.git(box.repo, "worktree", "add", "-q", "-b", "done", dir);
  writeFileSync(path.join(dir, "work.txt"), "work");
  box.git(dir, "add", "work.txt");
  box.git(dir, "commit", "-qm", "work");
  const prune = (args, { merged, cwd = box.repo } = {}) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, PATH: `${STUBS}:${process.env.PATH}`, GH_STUB_MERGED_HEADS: merged ?? "" },
    });
  return { box, dir, tip: box.git(dir, "rev-parse", "HEAD"), prune };
}

describe("prune-worktrees.mjs", () => {
  it("only lists by default, then removes the worktree and its branch with --apply", () => {
    const { box, dir, tip, prune } = setup();
    expect(prune([], { merged: tip }).stdout).toBe(`would remove ${dir} (done)\n`);
    expect(existsSync(dir)).toBe(true);
    expect(prune(["--apply"], { merged: tip }).stdout).toBe(`removed ${dir} (done)\n`);
    expect(existsSync(dir)).toBe(false);
    expect(box.git(box.repo, "branch", "--list", "done")).toBe("");
  });

  it("keeps a worktree whose merged head is not its tip: a commit came after the merge", () => {
    const { dir, prune } = setup();
    expect(prune(["--apply"], { merged: "0".repeat(40) }).stdout).toBe("");
    expect(existsSync(dir)).toBe(true);
  });

  it("keeps a dirty worktree, a detached one, the main checkout and the one it runs in", () => {
    const { box, dir, tip, prune } = setup();
    writeFileSync(path.join(dir, "draft.txt"), "uncommitted");
    expect(prune(["--apply"], { merged: tip }).stdout).toBe("");
    expect(existsSync(dir)).toBe(true);
    // Clean again, but the session runs in it.
    box.git(dir, "clean", "-fq");
    expect(prune(["--apply"], { merged: tip, cwd: dir }).stdout).toBe("");
    expect(existsSync(dir)).toBe(true);
    // `wt` is detached at the seed commit: merged as far as the stub knows, still kept.
    expect(prune(["--apply"], { merged: box.git(box.wt, "rev-parse", "HEAD") }).stdout).toBe("");
    expect(existsSync(box.wt)).toBe(true);
  });

  it("does nothing when gh cannot answer", () => {
    const { dir, tip } = setup();
    const r = spawnSync(process.execPath, [SCRIPT, "--apply"], {
      cwd: dir.replace(/done$/, "repo"),
      encoding: "utf8",
      env: { ...process.env, PATH: "/usr/bin:/bin", GH_STUB_MERGED_HEADS: tip },
    });
    expect(r.stdout).toBe("");
    expect(existsSync(dir)).toBe(true);
  });
});
