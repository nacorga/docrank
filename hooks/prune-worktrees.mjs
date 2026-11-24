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
 *     with the worktree's tip as its merged head. A tip merely reachable from
 *     `origin/<integration>` is not enough, and neither is a branch name used
 *     again that leaves an older merge behind: neither says this tip merged;
 *   - `git status` shows nothing, untracked files included.
 *
 * No idle-time heuristic stands in for the merge: how long a worktree's
 * reflog has been still cannot tell an idle live session from a dead one (a
 * freshly cut, unedited worktree has its tip on the integration branch), so
 * only a merged head does.
 *
 * `git status` does not list ignored files, and `git worktree remove` without
 * `--force` deletes them with the worktree (dependencies, build output).
 * Refusing on any would stop every prune, so they go, and the conditions above
 * read tracked and untracked files only.
 *
 * Every session's first answer waits for this hook, hence the one `gh` call,
 * the limit and its ten-second timeout: a worktree merged before the last 200
 * is for a hand to remove (`scripts/prune-worktrees.mjs`). Without `gh`,
 * offline or past the timeout, it does nothing, and it never fails the session.
 */
import path from "node:path";
import { loadConfig } from "../lib/config.mjs";
import { git, listWorktrees, run } from "../lib/git.mjs";
import { readInput } from "../lib/hook.mjs";

const GH_TIMEOUT = Number(process.env.DOCRANK_GH_TIMEOUT_MS) || 10_000;
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
  GH_TIMEOUT,
);
if (!listing) process.exit(0);
const merged = listing.split("\n").map((line) => line.split("\t"));

const removed = [];

for (const { path: dir, head, branch } of listWorktrees(main)) {
  if (!dir || !branch || dir === main || dir === here) continue;
  if (!merged.some(([name, oid]) => name === branch && oid === head)) continue;
  if (git(dir, "status", "--porcelain") !== "") continue;
  if (git(main, "worktree", "remove", dir) === null) continue;
  git(main, "branch", "-D", branch);
  removed.push(path.basename(dir));
}

if (removed.length) {
  process.stdout.write(`docrank: removed worktrees ${removed.join(", ")}, their pull requests already merged.\n`);
}
