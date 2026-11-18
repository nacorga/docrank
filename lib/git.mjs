/** What the guards and the worktree scripts share of git and gh. */
import { execFileSync } from "node:child_process";

export const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const glob = (g) =>
  new RegExp(`^${g.split("**").map((p) => p.split("*").map(esc).join("[^/]*")).join(".*")}$`);

/** The trimmed stdout of a command, or null when it fails. */
export const run = (cmd, args, cwd = ".") => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};
export const git = (dir, ...args) => run("git", ["-C", dir, ...args]);

/**
 * Whether `ref` is the tip GitHub shows as the merged head of a pull request
 * from `branch`. GitHub is the proof: an unpushed branch exists nowhere else,
 * and a commit pushed after the merge reaches nothing. Without an answer, false.
 */
export function mergedTip(dir, branch, ref) {
  const tip = git(dir, "rev-parse", "-q", "--verify", `${ref}^{commit}`);
  if (!tip) return false;
  const heads = run("gh", ["pr", "list", "--head", branch, "--state", "merged", "--json", "headRefOid", "-q", ".[].headRefOid"], dir);
  return !!heads && heads.split("\n").includes(tip);
}
