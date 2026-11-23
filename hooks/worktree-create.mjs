#!/usr/bin/env node
/**
 * WorktreeCreate: `claude -w <branch>` starts the session in a worktree of its
 * own, cut from a freshly fetched `origin/<branches.integration>`. Claude
 * Code's default is the remote's default branch, which is not always where
 * work branches from. The hook replaces that default entirely, so
 * `.worktreeinclude` is not read: `worktree.copy` takes its place.
 *
 * The work is `lib/worktree.mjs`, shared with `docrank worktree`. Claude Code
 * reads the path from the last line of stdout, so everything else goes to
 * stderr, and a failure fails the creation (docs/harness-facts.md, fact 2).
 */
import { createWorktree } from "../lib/worktree.mjs";
import { readInput } from "../lib/hook.mjs";

const warn = (message) => process.stderr.write(`WorktreeCreate: ${message}\n`);

const { name, cwd = process.cwd() } = await readInput();
try {
  process.stdout.write(`${createWorktree({ cwd, name, warn })}\n`);
} catch (e) {
  warn(e.message);
  process.exit(1);
}
