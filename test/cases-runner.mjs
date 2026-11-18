/**
 * Runs a hook the way Claude Code does: a JSON object on stdin, exit 0 to
 * allow, 2 to block. Each sandbox is a git repository with a sandbox HOME (the
 * audit log never touches the real one), a `gh` stub first on PATH, and the
 * repository's `.claude/docrank.json` committed, so a worktree reads it too.
 *
 * A cases file is one config and many cases, one per line:
 *
 *   CONFIG|{"branches":{"integration":"develop"}}   (optional, before the cases)
 *   BLOCK|<command>                  from a worktree on branch `topic`
 *   ALLOW|@<branch>|<command>        from the main checkout, on that branch
 *   ALLOW|@wt:<branch>|<command>     from a worktree, on that branch
 *
 * Lines starting with # and blank lines are skipped. The command is last, so it
 * may hold pipes.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const GUARD = path.join(here, "..", "hooks", "guard-bash.mjs");
export const STUBS = path.join(here, "stubs");

export function parseCases(file) {
  let config;
  const cases = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [first, ...rest] = line.split("|");
    if (first === "CONFIG") config = JSON.parse(rest.join("|"));
    else if (first === "BLOCK" || first === "ALLOW") {
      const at = rest[0].startsWith("@") && rest.length > 1 ? rest.shift().slice(1) : "wt:topic";
      cases.push({ expect: first, at, command: rest.join("|") });
    } else throw new Error(`${file}: unknown line: ${line}`);
  }
  return { config, cases };
}

export function sandbox({ config, hook = GUARD } = {}) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "docrank-guard-")));
  const repo = path.join(dir, "repo");
  const wt = path.join(dir, "wt");
  const git = (cwd, ...args) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "test");
  if (config) {
    mkdirSync(path.join(repo, ".claude"));
    writeFileSync(path.join(repo, ".claude", "docrank.json"), JSON.stringify(config));
    git(repo, "add", ".claude/docrank.json");
  }
  writeFileSync(path.join(repo, "seed.txt"), "");
  git(repo, "add", "seed.txt");
  git(repo, "commit", "-qm", "seed");
  git(repo, "worktree", "add", "-q", "--detach", wt);

  /** Puts the sandbox on `at` and returns the directory the command runs from. */
  const place = (at) => {
    if (at.startsWith("wt:")) {
      git(wt, "checkout", "-q", "-B", at.slice(3));
      return wt;
    }
    git(repo, "checkout", "-q", "-B", at);
    return repo;
  };

  return {
    dir,
    repo,
    wt,
    git,
    commonDir: path.join(repo, ".git"),
    /** The hook's exit status and stderr for `command`. */
    run(command, { at = "wt:topic", env = {} } = {}) {
      const cwd = place(at);
      const r = spawnSync("node", [hook], {
        input: JSON.stringify({ tool_input: { command } }),
        cwd,
        encoding: "utf8",
        env: { ...process.env, HOME: dir, CLAUDE_PROJECT_DIR: cwd, PATH: `${STUBS}:${process.env.PATH}`, ...env },
      });
      return { status: r.status, stderr: r.stderr };
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
