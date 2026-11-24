/**
 * `docrank worktree <branch> [<base>]`: the worktree `claude -w` makes, for a
 * session the `WorktreeCreate` hook did not reach (`--worktree --tmux`, Claude
 * Code older than v2.1.300, a session already running). Same directory, same
 * fetched base, same `worktree.copy` and `worktree.install` — `lib/worktree.mjs`
 * is the one implementation. Prints the directory.
 *
 * With no base the branch is cut from `origin/<branches.integration>`. A
 * `<base>`, a branch of the remote that slices share, is fetched and cut from
 * as `origin/<base>`; one that cannot be fetched fails, since cutting from a
 * stale copy would hide the work a slice builds on.
 */
import { spawnSync } from "node:child_process";
import { createWorktree } from "../worktree.mjs";

export default function worktree(args) {
  const [name, base, ...rest] = args;
  if (!name || rest.length) throw new Error("usage: docrank worktree <branch> [<base>]");
  if (base) {
    const fetched = spawnSync("git", ["fetch", "-q", "origin", base], { stdio: ["ignore", process.stderr, process.stderr] });
    if (fetched.status !== 0) throw new Error(`cannot fetch origin/${base}`);
  }
  return createWorktree({
    cwd: process.cwd(),
    name,
    base: base ? `origin/${base}` : null,
    warn: (m) => process.stderr.write(`docrank worktree: ${m}\n`),
  });
}
