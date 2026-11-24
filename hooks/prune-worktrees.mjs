#!/usr/bin/env node
/**
 * SessionStart, off unless `worktree.prune`: removes the worktrees, and their
 * local branches, whose work is already merged. A session cleans up its own
 * worktree when it hears the merge, but one that ended first never does, so
 * merged worktrees pile up beside the main checkout.
 *
 * A worktree goes only when all of these hold:
 *   - it is on a branch, and neither the main checkout nor the one this
 *     session starts in;
 *   - GitHub lists a merged pull request from its branch, among the last 200,
 *     with the worktree's tip as its merged head, or with the tip already on
 *     `origin/<integration>` (a branch name used again leaves an older merge
 *     behind, which says nothing of this tip);
 *   - `git status` shows nothing, untracked files included;
 *   - its HEAD's reflog has not moved for an hour, so a worktree another
 *     session has just cut under a branch name used before is left alone.
 *
 * Every session's first answer waits for this hook, hence the one `gh` call
 * and the limit: a worktree merged before the last 200 is for a hand to remove
 * (`scripts/prune-worktrees.mjs`). `origin/<integration>` is not fetched, since
 * a stale one only removes less. Without `gh`, or offline, it does nothing,
 * and it never fails the session.
 */
import path from "node:path";
import { loadConfig } from "../lib/config.mjs";
import { git, listWorktrees, run } from "../lib/git.mjs";
import { readInput } from "../lib/hook.mjs";

const HOUR = 3600;
const input = await readInput();
const cwd = input.cwd || process.cwd();

let config;
try {
  config = loadConfig({ cwd });
} catch {
  process.exit(0);
}
if (!config.worktree.prune) process.exit(0);

const common = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
if (!common) process.exit(0);
const main = path.dirname(common);
const here = git(cwd, "rev-parse", "--show-toplevel");

const listing = run(
  "gh",
  ["pr", "list", "--state", "merged", "--limit", "200", "--json", "headRefName,headRefOid", "-q", '.[] | .headRefName + "\\t" + .headRefOid'],
  main,
);
if (!listing) process.exit(0);
const merged = listing.split("\n").map((line) => line.split("\t"));

const now = Math.floor(Date.now() / 1000);
const onIntegration = (head) => git(main, "merge-base", "--is-ancestor", head, `origin/${config.branches.integration}`) !== null;
const removed = [];

for (const { path: dir, head, branch } of listWorktrees(main)) {
  if (!dir || !branch || dir === main || dir === here) continue;
  const heads = merged.filter(([name]) => name === branch).map(([, oid]) => oid);
  if (!heads.includes(head) && !(heads.length && onIntegration(head))) continue;
  if (git(dir, "status", "--porcelain") !== "") continue;
  // The reflog's own date, not the commit's: a worktree cut a minute ago from
  // an old commit has an old commit date and a fresh reflog entry.
  const moved = Number((git(dir, "log", "-g", "-1", "--date=unix", "--format=%gd", "HEAD") ?? "").replace(/\D/g, ""));
  if (!moved || moved > now - HOUR) continue;
  if (git(main, "worktree", "remove", dir) === null) continue;
  git(main, "branch", "-D", branch);
  removed.push(path.basename(dir));
}

if (removed.length) {
  process.stdout.write(`docrank: removed worktrees ${removed.join(", ")}, their pull requests already merged.\n`);
}
