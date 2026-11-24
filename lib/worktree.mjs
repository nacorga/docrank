/**
 * The one place a worktree is made: `hooks/worktree-create.mjs` (what
 * `claude -w` runs) and `docrank worktree` (what a session runs when the hook
 * did not) both call it, so a worktree has the same directory, base, copied
 * files and install however it came to be. A worktree cut by hand skips
 * `worktree.copy` and `worktree.install` and starts without `.env` or the
 * toolchain.
 *
 *   fix/where-to-look  ->  ../<repo>-where-to-look on fix/where-to-look
 *
 * Cut from a freshly fetched `origin/<branches.integration>`, with no upstream
 * (a bare `git push` must not aim at the integration branch). A `base`, a ref
 * the caller already has, is cut from instead and nothing is fetched: slices
 * that build on a shared branch start from it, not from the integration
 * branch. A name that is
 * already a worktree reopens it; a branch that already exists is checked out
 * rather than recreated. Install output goes to stderr, never stdout.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { git } from "./git.mjs";

/**
 * Makes (or reopens) the worktree for branch `name` of the repository `cwd` is
 * in, and returns its directory. Throws with the reason when it cannot;
 * `warn` hears what does not fail it (a fetch or an install that failed).
 * `base`, when given, is the ref to cut from; a branch that already exists is
 * checked out as it is.
 */
export function createWorktree({ cwd, name, base = null, warn = () => {} }) {
  if (!name) throw new Error("no worktree name");

  // The main checkout, even when called from inside another worktree.
  const common = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!common) throw new Error(`${cwd} is not in a git repository`);
  const main = path.dirname(common);

  const { branches, worktree } = loadConfig({ cwd: main });

  const dir = path.join(path.dirname(main), `${path.basename(main)}-${name.replace(/^[^/]*\//, "").replaceAll("/", "-")}`);
  if (existsSync(dir)) return dir;

  const ref = base || `origin/${branches.integration}`;
  const sh = (...args) => spawnSync("git", ["-C", main, ...args], { stdio: ["ignore", process.stderr, process.stderr] }).status === 0;
  if (!base && !sh("fetch", "-q", "origin", branches.integration)) warn(`fetch failed; cutting from the cached ${ref}`);
  const added = git(main, "show-ref", "--verify", "-q", `refs/heads/${name}`) !== null
    ? sh("worktree", "add", "-q", dir, name)
    : sh("worktree", "add", "-q", "--no-track", "-b", name, dir, ref);
  if (!added) throw new Error(`could not create ${dir}`);

  for (const file of worktree.copy) {
    if (!existsSync(path.join(main, file))) continue;
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    copyFileSync(path.join(main, file), path.join(dir, file));
  }
  if (worktree.install) {
    const install = spawnSync(worktree.install, { cwd: dir, shell: true, stdio: ["ignore", process.stderr, process.stderr] });
    if (install.status !== 0) warn(`\`${worktree.install}\` failed; run it in ${dir}`);
  }
  return dir;
}
