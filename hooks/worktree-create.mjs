#!/usr/bin/env node
/**
 * WorktreeCreate: `claude -w <branch>` starts the session in a worktree of its
 * own, cut from a freshly fetched `origin/<branches.integration>`. Claude
 * Code's default is the remote's default branch, which is not always where
 * work branches from. The hook replaces that default entirely, so
 * `.worktreeinclude` is not read: `worktree.copy` takes its place.
 *
 *   claude -w fix/where-to-look  ->  ../<repo>-where-to-look on fix/where-to-look
 *
 * A name that is already a worktree reopens it; a branch that already exists is
 * checked out rather than recreated. Claude Code reads the path from the last
 * line of stdout, so everything else goes to stderr, and a failure fails the
 * creation (docs/harness-facts.md, fact 2).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ConfigError, loadConfig } from "../lib/config.mjs";
import { git } from "../lib/git.mjs";
import { readInput } from "../lib/hook.mjs";

const warn = (message) => process.stderr.write(`WorktreeCreate: ${message}\n`);
const fail = (message) => {
  warn(message);
  process.exit(1);
};

const { name, cwd = process.cwd() } = await readInput();
if (!name) fail("no worktree name");

// The main checkout, even when the session starts inside another worktree.
const common = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
if (!common) fail(`${cwd} is not in a git repository`);
const main = path.dirname(common);

let config;
try {
  config = loadConfig({ cwd: main });
} catch (e) {
  if (!(e instanceof ConfigError)) throw e;
  fail(e.message);
}
const { branches, worktree } = config;

const dir = path.join(path.dirname(main), `${path.basename(main)}-${name.replace(/^[^/]*\//, "").replaceAll("/", "-")}`);
if (existsSync(dir)) {
  process.stdout.write(`${dir}\n`);
  process.exit(0);
}

const ref = `origin/${branches.integration}`;
const sh = (...args) => spawnSync("git", ["-C", main, ...args], { stdio: ["ignore", process.stderr, process.stderr] }).status === 0;
if (!sh("fetch", "-q", "origin", branches.integration)) warn(`fetch failed; cutting from the cached ${ref}`);
// --no-track: an upstream of the integration branch would aim a bare `git push` at it.
const added = git(main, "show-ref", "--verify", "-q", `refs/heads/${name}`) !== null
  ? sh("worktree", "add", "-q", dir, name)
  : sh("worktree", "add", "-q", "--no-track", "-b", name, dir, ref);
if (!added) fail(`could not create ${dir}`);

for (const file of worktree.copy) {
  if (!existsSync(path.join(main, file))) continue;
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  copyFileSync(path.join(main, file), path.join(dir, file));
}
if (worktree.install) {
  const install = spawnSync(worktree.install, { cwd: dir, shell: true, stdio: ["ignore", process.stderr, process.stderr] });
  if (install.status !== 0) warn(`\`${worktree.install}\` failed; run it in ${dir}`);
}

process.stdout.write(`${dir}\n`);
