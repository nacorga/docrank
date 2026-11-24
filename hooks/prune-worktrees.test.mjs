import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STUBS, sandbox } from "../test/cases-runner.mjs";

const HOOK = path.join(import.meta.dirname, "prune-worktrees.mjs");
const boxes = [];
afterEach(() => boxes.splice(0).forEach((b) => b.cleanup()));

const HOURS_AGO = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

/**
 * A repository with a worktree `done` holding one commit, made `age` hours ago.
 * `merged` lists what the gh stub says is merged, one `<branch>\t<head>` per line.
 */
function setup({ config = { worktree: { prune: true } }, age = 5 } = {}) {
  const box = sandbox({ config });
  boxes.push(box);
  const dir = path.join(box.dir, "done");
  box.git(box.repo, "worktree", "add", "-q", "-b", "done", dir);
  const tip = commitAt(box, dir, age, "work.txt");
  const prune = ({ merged = "", cwd = box.repo, path: PATH = `${STUBS}:${process.env.PATH}` } = {}) =>
    spawnSync(process.execPath, [HOOK], {
      cwd,
      input: JSON.stringify({ cwd }),
      encoding: "utf8",
      env: { ...process.env, PATH, GH_STUB_MERGED_PRS: merged },
    });
  return { box, dir, tip, prune };
}

/** Commits in `dir` with the committer date `age` hours ago, which dates the reflog entry. */
function commitAt(box, dir, age, name) {
  writeFileSync(path.join(dir, name), name);
  box.git(dir, "add", name);
  const date = HOURS_AGO(age);
  const { status } = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", name], {
    env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date },
  });
  expect(status).toBe(0);
  return box.git(dir, "rev-parse", "HEAD");
}

/** A merged pull request from `done` as the stub lists it. */
const mergedAs = (head, branch = "done") => `${branch}\t${head}`;

describe("prune-worktrees.mjs, a hook that is off unless worktree.prune", () => {
  it("removes a worktree and its branch whose pull request merged with its tip", () => {
    const { box, dir, tip, prune } = setup({ age: 3 });
    const r = prune({ merged: mergedAs(tip) });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("stickler: removed worktrees done, their pull requests already merged.\n");
    expect(existsSync(dir)).toBe(false);
    expect(box.git(box.repo, "branch", "--list", "done")).toBe("");
  });

  it("removes one whose merged head is its tip however recently its reflog moved: no idle-hour rule", () => {
    const { dir, tip, prune } = setup({ age: 0 });
    expect(prune({ merged: mergedAs(tip) }).stdout).toContain("removed worktrees done");
    expect(existsSync(dir)).toBe(false);
  });

  it("keeps an idle, freshly cut worktree whose tip is on origin/<integration>, whatever older merge its branch name has", () => {
    const { box, dir, prune } = setup({ age: 5 });
    const tip = box.git(dir, "rev-parse", "HEAD");
    box.git(box.repo, "update-ref", "refs/remotes/origin/main", tip);
    // The merged head GitHub lists is another commit: the branch name was used before.
    expect(prune({ merged: mergedAs("0".repeat(40)) }).stdout).toBe("");
    expect(existsSync(dir)).toBe(true);
  });

  it("deletes ignored files with the worktree, which git status does not list", () => {
    const { box, dir, tip, prune } = setup();
    writeFileSync(path.join(box.repo, ".git", "info", "exclude"), "node_modules/\n", { flag: "a" });
    mkdirSync(path.join(dir, "node_modules"));
    writeFileSync(path.join(dir, "node_modules", "dep.js"), "ignored");
    expect(box.git(dir, "status", "--porcelain")).toBe("");
    expect(prune({ merged: mergedAs(tip) }).stdout).toContain("removed worktrees done");
    expect(existsSync(dir)).toBe(false);
  });

  it("keeps one whose tip is on origin/<integration> but whose branch has no merged pull request", () => {
    const { box, dir, tip, prune } = setup();
    box.git(box.repo, "update-ref", "refs/remotes/origin/main", tip);
    expect(prune({ merged: mergedAs(tip, "another") }).stdout).toBe("");
    expect(prune({ merged: "" }).stdout).toBe("");
    expect(existsSync(dir)).toBe(true);
  });

  it("keeps one whose merged head is another commit, with the tip on no integration branch: a commit came after the merge", () => {
    const { dir, prune } = setup();
    expect(prune({ merged: mergedAs("0".repeat(40)) }).stdout).toBe("");
    expect(existsSync(dir)).toBe(true);
  });

  it("keeps a worktree with anything uncommitted, untracked files included", () => {
    const { dir, tip, prune } = setup();
    writeFileSync(path.join(dir, "draft.txt"), "uncommitted");
    expect(prune({ merged: mergedAs(tip) }).stdout).toBe("");
    expect(existsSync(dir)).toBe(true);
  });

  it("keeps the main checkout, the worktree the session starts in and a detached one", () => {
    const { box, dir, tip, prune } = setup();
    expect(prune({ merged: mergedAs(tip), cwd: dir }).stdout).toBe("");
    expect(existsSync(dir)).toBe(true);
    // `wt` is detached at the seed commit, the main checkout is on a branch the stub lists as merged.
    const seed = box.git(box.wt, "rev-parse", "HEAD");
    expect(prune({ merged: [mergedAs(seed, "main"), mergedAs(seed, "wt")].join("\n") }).stdout).toBe("");
    expect(existsSync(box.wt)).toBe(true);
    expect(existsSync(box.repo)).toBe(true);
  });

  it("reads the last 200 pull requests of the repository, in one call", () => {
    const { box, dir, tip } = setup();
    const log = path.join(box.dir, "gh.log");
    const stub = path.join(box.dir, "bin");
    spawnSync("mkdir", ["-p", stub]);
    writeFileSync(path.join(stub, "gh"), `#!/bin/sh\necho "$*" >> "${log}"\nprintf 'done\\t${tip}\\n'\n`, { mode: 0o755 });
    spawnSync(process.execPath, [HOOK], {
      cwd: box.repo,
      input: JSON.stringify({ cwd: box.repo }),
      encoding: "utf8",
      env: { ...process.env, PATH: `${stub}:${process.env.PATH}` },
    });
    const calls = spawnSync("cat", [log], { encoding: "utf8" }).stdout.trim().split("\n");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^pr list --state merged --limit 200 --json headRefName,headRefOid/u);
    expect(existsSync(dir)).toBe(false);
  });

  it("does nothing by default, whatever GitHub says", () => {
    const { dir, tip, prune } = setup({ config: {} });
    expect(prune({ merged: mergedAs(tip) }).stdout).toBe("");
    expect(existsSync(dir)).toBe(true);
  });

  it("does nothing, and fails nothing, when gh outlasts its timeout", () => {
    const { box, dir, tip } = setup();
    const stub = path.join(box.dir, "slow");
    mkdirSync(stub);
    writeFileSync(path.join(stub, "gh"), `#!/bin/sh\nsleep 5\nprintf 'done\\t${tip}\\n'\n`, { mode: 0o755 });
    const started = Date.now();
    const r = spawnSync(process.execPath, [HOOK], {
      cwd: box.repo,
      input: JSON.stringify({ cwd: box.repo }),
      encoding: "utf8",
      env: { ...process.env, PATH: `${stub}:${process.env.PATH}`, STICKLER_GH_TIMEOUT_MS: "300" },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(Date.now() - started).toBeLessThan(4000);
    expect(existsSync(dir)).toBe(true);
  });

  it("does nothing, and fails nothing, when gh cannot answer", () => {
    const { dir, tip, prune } = setup();
    const r = prune({ merged: mergedAs(tip), path: "/usr/bin:/bin" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(existsSync(dir)).toBe(true);
  });

  it("does nothing, and fails nothing, outside a repository or on an unusable config", () => {
    const { box, dir, tip, prune } = setup();
    expect(prune({ merged: mergedAs(tip), cwd: box.dir }).status).toBe(0);
    writeFileSync(path.join(box.repo, ".claude", "stickler.json"), '{"worktree":{"prune":"yes"}}');
    const r = prune({ merged: mergedAs(tip) });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(existsSync(dir)).toBe(true);
  });
});
