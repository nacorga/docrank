/**
 * `docrank worktree <branch>`: the worktree `claude -w` makes, for a session
 * the `WorktreeCreate` hook did not reach (`--worktree --tmux`, Claude Code
 * older than v2.1.300, a session already running). Same directory, same
 * fetched base, same `worktree.copy` and `worktree.install` — `lib/worktree.mjs`
 * is the one implementation. Prints the directory. Takes no base: every
 * worktree is cut from `origin/<branches.integration>`, since nothing in
 * docrank shares a base between slices.
 */
import { createWorktree } from "../worktree.mjs";

export default function worktree(args) {
  const [name, ...rest] = args;
  if (!name || rest.length) throw new Error("usage: docrank worktree <branch>");
  return createWorktree({ cwd: process.cwd(), name, warn: (m) => process.stderr.write(`docrank worktree: ${m}\n`) });
}
