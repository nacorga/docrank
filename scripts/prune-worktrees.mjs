#!/usr/bin/env node
/**
 * Lists, and with `--apply` removes, the worktrees whose branch's pull request
 * merged with the worktree's own tip as the merged head: the rule `guard-bash`
 * holds a branch deletion to (`mergedTip`), so whatever it would let a session
 * delete, this removes. A dirty worktree, a detached one (no branch to look
 * up), the main checkout and the one this runs in are left alone. Without
 * `gh`, or offline, nothing qualifies.
 *
 *   node prune-worktrees.mjs           what would go
 *   node prune-worktrees.mjs --apply   remove each worktree and its local branch
 */
import path from "node:path";
import { git, mergedTip } from "../lib/git.mjs";

const apply = process.argv.includes("--apply");
const here = git(process.cwd(), "rev-parse", "--show-toplevel");
const common = git(process.cwd(), "rev-parse", "--path-format=absolute", "--git-common-dir");
if (!here || !common) {
  process.stderr.write("not in a git repository\n");
  process.exit(1);
}
const main = path.dirname(common);

const listed = git(main, "worktree", "list", "--porcelain").split("\n\n").map((block) => {
  const field = (key) => block.split("\n").find((l) => l.startsWith(`${key} `))?.slice(key.length + 1);
  return { path: field("worktree"), head: field("HEAD"), branch: field("branch")?.replace(/^refs\/heads\//, "") };
});

for (const { path: dir, head, branch } of listed) {
  if (!dir || !branch || dir === main || dir === here) continue;
  if (git(dir, "status", "--porcelain") !== "" || !mergedTip(main, branch, head)) continue;
  if (apply) {
    if (git(main, "worktree", "remove", dir) === null) continue;
    git(main, "branch", "-D", branch);
  }
  console.log(`${apply ? "removed" : "would remove"} ${dir} (${branch})`);
}
