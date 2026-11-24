#!/usr/bin/env node
/**
 * Builds a throwaway repository in which the spec arbiter has something real
 * to find: a change that passes its test and breaks a rule its spec writes
 * down (`examples/consent`). It is the `demo` skill's whole work, a script
 * rather than steps a session improvises, so every run builds the same thing.
 *
 *   node demo.mjs          a new directory under the system's temp directory
 *   node demo.mjs <dir>    <dir>, which must not exist: one that does is refused untouched
 *
 * Inside: `origin.git`, a bare remote; `repo`, the main checkout on `main`,
 * pushed, which stays there because the Bash guard keeps the main checkout on
 * the integration branch; `repo-tracking`, a worktree on `demo/tracking`
 * (`changes/tracking.patch`); and `demo/fixed` on top of it
 * (`changes/fixed.patch`). The patches stay out of the repository so the judge
 * cannot read the answer. The git identity is set in the repository, so a
 * machine with no global one builds it too.
 *
 * The session is opened with `--plugin-dir` this plugin's root: it loads this
 * copy whatever scope stickler is installed at, and a project- or local-scope
 * install elsewhere is not enabled in a new directory (docs/harness-facts.md,
 * fact 16).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE = path.join(PLUGIN_ROOT, "examples", "consent");
const CHANGES = "changes";

const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
/** A path as one shell word. */
const sh = (s) => (/^[\w@%+=:,./-]+$/u.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

/** Copies the example into `to`, all but the patches. */
function copyExample(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (from === EXAMPLE && entry.name === CHANGES) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true });
      copyExample(source, target);
    } else writeFileSync(target, readFileSync(source));
  }
}

const args = process.argv.slice(2);
if (args.length > 1) die("usage: demo.mjs [<dir>]");
let dir;
if (args[0]) {
  dir = path.resolve(args[0]);
  if (existsSync(dir)) die(`${dir} exists. Name a directory that does not: the demo never writes into one.`);
  mkdirSync(dir, { recursive: true });
  dir = realpathSync(dir);
} else dir = realpathSync(mkdtempSync(path.join(tmpdir(), "stickler-demo-")));

const origin = path.join(dir, "origin.git");
const repo = path.join(dir, "repo");
const worktree = path.join(dir, "repo-tracking");
const commit = (cwd, message) => {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", message);
};

try {
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "stickler demo");
  git(repo, "config", "user.email", "demo@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  copyExample(EXAMPLE, repo);
  commit(repo, "feat(checkout): the checkout and its spec");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "-u", "origin", "main");

  git(repo, "worktree", "add", "-q", "-b", "demo/tracking", worktree, "main");
  git(worktree, "apply", path.join(EXAMPLE, CHANGES, "tracking.patch"));
  commit(worktree, "feat(checkout): report the checkout to analytics");
  git(worktree, "switch", "-q", "-c", "demo/fixed");
  git(worktree, "apply", path.join(EXAMPLE, CHANGES, "fixed.patch"));
  commit(worktree, "fix(checkout): report only after consent, and without the email");
  git(worktree, "switch", "-q", "demo/tracking");
} catch (e) {
  rmSync(dir, { recursive: true, force: true });
  die(`The demo could not be built, and ${dir} was removed: ${e.stderr?.toString().trim() || e.message}`);
}

process.stdout.write(`stickler demo in ${dir}

  origin.git      a bare remote; main is pushed to it
  repo            the main checkout, on main
  repo-tracking   a worktree on demo/tracking: the checkout reports to analytics,
                  its test passes, and docs/spec.md § Analytics forbids what it sends
  demo/fixed      a branch on top of demo/tracking with the fix

Open a session in the worktree, with this copy of the plugin:

  cd ${sh(worktree)} && claude --plugin-dir ${sh(PLUGIN_ROOT)}

--plugin-dir loads this copy for that session whatever scope stickler is
installed at, and replaces an installed one; a project- or local-scope
install in another repository is not enabled in this new directory
(docs/harness-facts.md, fact 16).

Then type, one at a time, each line as it is:

  1. /stickler:gates
  2. Review this branch with stickler:spec-arbiter.
  3. Switch this worktree to demo/fixed, then have the same arbiter re-check demo/tracking..HEAD.

What to expect, kept apart so a pasted step carries no hint to the judge:

  1. The test passes and the commit is recorded.
  2. A code defect citing docs/spec.md § Analytics: the event is sent before
     consent and carries the email.
  3. That finding resolved.

To remove the demo: rm -rf ${sh(dir)}
`);
