#!/usr/bin/env node
/**
 * PreToolUse hook on Bash: refuses the commands that cannot be taken back, and
 * a push whose commit has not passed the gates. A deterministic net that does
 * not rely on the model's judgement; every setting comes from `lib/config.mjs`.
 *
 * It matches the command string, not a shell parse: a program name counts only
 * at a command position (start of a line, or after `; & | (`), so a commit
 * message that describes a rule is not the rule. Scope is accidents; a
 * deliberately obfuscated form (`bash -c "git push ..."`) is out of it, and
 * every refusal is logged to ~/.claude/blocked-commands.log anyway.
 *
 * Exit 0 allows; exit 2 refuses, with the reason on stderr for the model.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../lib/config.mjs";
import { writeErr } from "../lib/stdio.mjs";
import { esc, git, glob, mergedTip, run } from "../lib/git.mjs";
import { recordRefusal } from "../lib/watch/record.mjs";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {}
const command = input?.tool_input?.command;
if (!command) process.exit(0);

let config;

function refuse(reason, message) {
  try {
    const log = path.join(os.homedir(), ".claude", "blocked-commands.log");
    mkdirSync(path.dirname(log), { recursive: true });
    appendFileSync(log, `[${new Date().toISOString()}] ${reason}\n  cmd: ${command}\n`);
  } catch {}
  // No hook event reports this refusal (harness fact 21): stickler watch hears it here.
  recordRefusal(input, config, message, "guard-bash");
  writeErr(`${message}\n`);
  process.exit(2);
}

try {
  config = loadConfig({ cwd: process.cwd() });
} catch (e) {
  // Failing open would turn a typo in the config into a silent bypass.
  refuse("config", `BLOCKED: the stickler configuration is unusable, so no command is checked. Fix it first (Edit tool); the problems:\n${e.message}`);
}
const { branches, guard, gates } = config;

/* -- matching helpers ------------------------------------------------------ */

const S = String.raw`[ \t]`;
const ARGS = String.raw`[^|&;\n]*`; // the rest of one command's arguments
const POS = String.raw`(?:^|&&|\|\||[;&|(])${S}*`; // a command position
const GIT = String.raw`${POS}git${S}+(?:-C${S}+\S+${S}+)?`;
const GH = String.raw`${POS}gh${S}+`;

const has = (src) => new RegExp(src, "m").test(command);
const all = (src) => [...command.matchAll(new RegExp(src, "gm"))];
const words = (s) => s.split(/\s+/).filter(Boolean);
// What a push names besides its flags and redirections: the remote, then refspecs.
const positional = (ws) => ws.filter((w) => !w.startsWith("-") && !/^[0-9]*[<>&]/.test(w));
const unquote = (s) => s.replace(/["']/g, "");
const names = (list) => (list.length ? list.join(", ") : "none");

const succeeds = (dir, ...args) => git(dir, ...args) !== null;
const isDir = (d) => existsSync(d) && statSync(d).isDirectory();

const protectedBranches = branches.protected;
const integration = branches.integration;
const allowedBases = branches.allowedPrBases.map(glob);
const baseAllowed = (b) => allowedBases.some((g) => g.test(b));

/*
 * The hook runs in its own cwd, not necessarily the repository a command
 * targets: a worktree sits beside it, and a command reaches it with `cd` or
 * `git -C`. The directory is the last `-C <path>`, else the last `cd`, else
 * the hook's own. One that does not resolve (an unexpanded variable) falls back
 * and still checks: allowing on a typo would be a silent bypass.
 */
function targetDir() {
  const expand = (d) => unquote(d).replace(/^~/, os.homedir());
  const last = (src) => all(src).at(-1)?.[1];
  const c = last(String.raw`git${S}+-C${S}+(\S+)`);
  if (c && isDir(expand(c))) return expand(c);
  const cd = last(String.raw`${POS}cd${S}+([^;&|\n]+)`);
  if (cd && isDir(expand(cd.trim()))) return expand(cd.trim());
  return ".";
}
const branchOf = (dir) => git(dir, "rev-parse", "--abbrev-ref", "HEAD") ?? "";

/* -- destructive git ------------------------------------------------------- */

if (has(String.raw`${GIT}(?:reset${S}+--hard|clean${S}+-[a-zA-Z]*f[a-zA-Z]*d|clean${S}+-[a-zA-Z]*d[a-zA-Z]*f|checkout${S}+\.${S}*$)`)) {
  refuse("git-destructive", "BLOCKED: destructive git command (reset --hard / clean -fd / checkout .) throws away work git cannot bring back. Ask the user for explicit confirmation before running it.");
}

if (has(String.raw`${GIT}push${S}+${ARGS}--force\b`) && !has(String.raw`${GIT}push${S}+${ARGS}--force-with-lease\b`)) {
  refuse("git-force-push", "BLOCKED: 'git push --force' overwrites what the remote holds. Use --force-with-lease, or ask the user for explicit confirmation.");
}
if (has(String.raw`${GIT}push${S}+(?:${ARGS}${S})?-f(?:${S}|$)`)) {
  refuse("git-force-push", "BLOCKED: 'git push -f' overwrites what the remote holds. Use --force-with-lease, or ask the user for explicit confirmation.");
}

/* -- pushes ----------------------------------------------------------------- */

const pushes = all(String.raw`${GIT}push\b(${ARGS})`).map((m) => words(m[1]));
if (pushes.length) {
  const list = names(protectedBranches);
  const landing = `Protected branches (${list}) are changed only through pull requests: open one, or ask the user to run it themselves.`;
  const alt = protectedBranches.map(esc).join("|");
  // `origin main`, `-u origin main`, `HEAD:main`, `+main`, `origin main --no-verify`.
  if (alt && has(String.raw`${GIT}push\b${ARGS}(?:${S}|:|\+)(?:${alt})(?:${S}|$)`)) {
    refuse("push-protected", `BLOCKED: this push targets a protected branch. ${landing}`);
  }
  // A push with no refspec pushes the current branch, which the command cannot name.
  if (pushes.some((ws) => positional(ws).length < 2)) {
    const current = branchOf(targetDir());
    if (protectedBranches.includes(current)) {
      refuse("push-protected", `BLOCKED: bare 'git push' while on ${current}. ${landing}`);
    }
  }
  // --tags and --follow-tags carry tags the command does not name.
  if (guard.blockedTagPatterns.length) {
    const patterns = guard.blockedTagPatterns.map((p) => new RegExp(p, "u"));
    const dir = targetDir();
    const tagName = (ref) =>
      ref.startsWith("refs/tags/") ? ref.slice(10) : succeeds(dir, "show-ref", "--verify", "--quiet", `refs/tags/${ref}`) ? ref : null;
    for (const ws of pushes) {
      const tags = ws.some((w) => w === "--tags" || w === "--follow-tags")
        ? "--tags and --follow-tags"
        : positional(ws).slice(1).flatMap((r) => r.replace(/^\+/, "").split(":")).map(tagName).find((t) => t && patterns.some((p) => p.test(t)));
      if (tags) {
        refuse("push-tag", `BLOCKED: pushing ${tags === "--tags and --follow-tags" ? tags : `tag ${tags}`} (guard.blockedTagPatterns: ${guard.blockedTagPatterns.join(", ")}). A tag of that kind is created by the release process, and one pushed by hand tells it a version shipped that did not. Ask the user to push it.`);
      }
    }
  }
  // --no-verify skips git's own pre-push hook: the reach a refused push invites.
  if (has(String.raw`${GIT}push\b${ARGS}${S}--no-verify\b`)) {
    refuse("push-no-verify", "BLOCKED: 'git push --no-verify' skips the hooks that check a push. Run the checks they run, then push; only the user skips them.");
  }
}

/* -- landing on a protected branch by another route ------------------------ */

// The command cannot say where a merge lands, so GitHub is asked for the base
// of each pull request named. A merge naming none, one whose base cannot be
// read, and --admin (which overrides the checks a green pull request passed)
// all refuse.
const merges = all(String.raw`${GH}pr${S}+merge\b`);
if (merges.length) {
  const rule = `A merge into a protected branch (${names(protectedBranches)}) is always the user's; into any other base it is allowed only if the base is one of branches.allowedPrBases (${names(branches.allowedPrBases)}).`;
  if (has(String.raw`${GH}pr${S}+merge\b${ARGS}--admin\b`)) {
    refuse("merge", `BLOCKED: 'gh pr merge --admin' overrides the checks a pull request must pass. ${rule}`);
  }
  const refs = all(String.raw`${GH}pr${S}+merge${S}+([^\s|&;-][^\s|&;]*)`).map((m) => unquote(m[1]));
  if (refs.length !== merges.length) {
    refuse("merge", `BLOCKED: 'gh pr merge' names no pull request right after 'merge'. ${rule}`);
  }
  for (const ref of refs) {
    const base = run("gh", ["pr", "view", ref, "--json", "baseRefName", "--jq", ".baseRefName"], targetDir());
    if (!base || protectedBranches.includes(base) || !baseAllowed(base)) {
      refuse("merge", `BLOCKED: 'gh pr merge ${ref}' lands on '${base || "a base GitHub did not name"}'. ${rule}`);
    }
  }
}

// The API merges without a base this guard can read: REST's pull request merge
// and branch merge, and GraphQL's merge and auto-merge mutations.
if (has(String.raw`${GH}api\b${ARGS}(?:pulls/[^\s/]+/merge\b|/merges\b|mergePullRequest|mergeBranch|enablePullRequestAutoMerge)`)) {
  refuse("merge", "BLOCKED: a merge through 'gh api' names no base this guard can read. Merge with 'gh pr merge <n>'; read a pull request's state with 'gh pr view'.");
}

// A pull request opened on another pull request's branch is closed by GitHub
// when that branch merges and is deleted; it is not retargeted.
for (const m of all(String.raw`${GH}pr${S}+(?:create|edit)\b(${ARGS})`)) {
  for (const [, raw] of m[1].matchAll(/(?:--base|-B)[ \t=]+(\S+)/g)) {
    const base = unquote(raw);
    if (!protectedBranches.includes(base) && !baseAllowed(base)) {
      refuse("pr-base", `BLOCKED: a pull request against '${base}'. A pull request opens against one of ${names([...protectedBranches, ...branches.allowedPrBases])}, never another pull request's branch: GitHub closes it when that branch merges and is deleted.`);
    }
  }
}

// `merge` must be followed by whitespace or the end: \b also matches the hyphen
// of `git merge-base`, `merge-tree`, `merge-file`, which only inspect a merge.
if (has(String.raw`${GIT}merge(?:${S}|$)`) && !has(String.raw`${GIT}merge${S}+--(?:abort|continue|quit)\b`)) {
  const current = branchOf(targetDir());
  if (protectedBranches.includes(current)) {
    refuse("merge", `BLOCKED: 'git merge' while on ${current}, a protected branch. It is changed only through pull requests; the user owns the merge.`);
  }
}

/* -- the main checkout stays on the integration branch ---------------------- */

// Every session that has not entered a worktree works in the main checkout, so
// one session switching it switches it under all of them.
function isMainCheckout(dir) {
  const top = git(dir, "rev-parse", "--show-toplevel");
  const common = git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return !!top && !!common && realpathSync(top) === realpathSync(path.dirname(common));
}

// Whether any switch or checkout in the command moves HEAD. `git checkout`
// also restores files (`-- <path>`, or a path alone), which stays allowed.
function switchesBranch(dir) {
  if (has(String.raw`${GH}pr${S}+checkout\b`)) return true;
  const re = String.raw`git${S}+(?:-C${S}+\S+${S}+)?(switch|checkout)\b([^;&|\n]*)`;
  for (const [, verb, args] of all(re)) {
    const ws = words(args);
    if (verb === "switch") {
      const rest = ws.filter((w) => w !== "-q" && w !== "--quiet");
      if (rest.length !== 1 || rest[0] !== integration) return true;
      continue;
    }
    if (ws.some((w) => w === "--" || w === "-p" || w === "--patch")) continue;
    let target = "";
    for (const w of ws) {
      if (["-", "-b", "-B", "--orphan", "--detach", "-t", "--track"].includes(w)) return true;
      if (!w.startsWith("-") && !target) target = w;
    }
    if (!target || target === integration || existsSync(path.join(dir, target))) continue;
    if (succeeds(dir, "rev-parse", "-q", "--verify", `${target}^{commit}`)) return true;
  }
  return false;
}

if (has(String.raw`${GIT}(?:switch|checkout)\b|${GH}pr${S}+checkout\b`)) {
  const dir = targetDir();
  if (isMainCheckout(dir) && switchesBranch(dir)) {
    refuse("main-checkout", `BLOCKED: this moves the main checkout off ${integration}, under every session working in it. Branch work goes in a worktree: node "${process.env.CLAUDE_PLUGIN_ROOT ?? "<plugin>"}/bin/stickler.mjs" worktree <branch> cuts one from origin/${integration}, with worktree.copy and worktree.install. Going back to ${integration} is allowed.`);
  }
}

/* -- deleting a branch ------------------------------------------------------ */

// A branch is deleted only once GitHub shows its pull request merged with the
// branch's own tip as the merged head. An unpushed branch deleted on a "done"
// exists nowhere else, and a commit pushed after the merge reaches nothing;
// both pass `git branch -D` silently. GitHub is the proof, and without an
// answer the check refuses.
const NOT_MERGED = "its pull request is not merged with this branch's tip as the merged head (gh pr list --head <branch> --state merged). Deleting it loses what exists nowhere else, or a commit pushed after the merge. Keep it and say what is pending, or ask the user to run it themselves.";
const HIDDEN = "BLOCKED: a redirection hides what follows it from this guard, which cannot then tell which branch is deleted. Put the redirection after the branch names, or ask the user to run it themselves.";

// A redirection is no branch name, and the cuts below end at `&` or `|`, so the
// ones that hold one are rewritten first or they would hide the names after
// them: a descriptor duplicated or closed (`2>&1`, `>&-`) standing as a word of
// its own is dropped, and `&>file`, `>&file`, `>|file` become `> file`.
// Glued to a name (`feat/v2>&1`) a redirection stays, and that name refuses.
let stripped = command;
for (let before; before !== stripped; ) {
  before = stripped;
  stripped = stripped.replace(/(^|[ \t])[0-9]*[<>]&(?:[0-9]+|-)([ \t]|$)/m, "$1$2");
}
stripped = stripped.replace(/&>/g, " >").replace(/>&([^0-9-])/g, "> $1").replace(/>\|/g, ">");

// In the words, a redirection is skipped, and so is the file after one that
// stands alone, but only while each is plainly literal: a quote, `$`, a
// backtick, `\`, a bracket or a brace may carry the word past a `;`, `&`, `|`
// or the end of the line, where the cut stops reading, so such a word marks
// what follows as hidden. One still waiting for its file at the cut hid what
// came after too. A deletion with anything hidden refuses.
const REDIRECTION = /^[0-9]*[<>]/;
const REDIRECTION_ALONE = /^[0-9]*[<>]+$/;
const LITERAL_REDIRECTION = /^[0-9]*[<>]+[A-Za-z0-9_./~@%+=:,-]*$/;
const LITERAL_FILE = /^[A-Za-z0-9_./~@%+=:,-]+$/;

/** Sorts a command's words into what `onWord` takes; reports whether anything was hidden. */
function scan(ws, onWord) {
  let file = false;
  let hidden = false;
  for (const w of ws) {
    if (file) {
      hidden ||= !LITERAL_FILE.test(w);
      file = false;
    } else if (REDIRECTION.test(w)) {
      if (!LITERAL_REDIRECTION.test(w)) hidden = true;
      else if (REDIRECTION_ALONE.test(w)) file = true;
    } else onWord(w);
  }
  return hidden || file;
}

const cut = (verb) =>
  [...stripped.matchAll(new RegExp(String.raw`${POS}git${S}+(?:-C${S}+\S+${S}+)?${verb}\b([^;&|\n]*)`, "gm"))].map((m) => words(m[1]));

if (has(String.raw`${GIT}branch\b`)) {
  const dir = targetDir();
  for (const ws of cut("branch")) {
    let del = false;
    let force = false;
    const named = [];
    const hidden = scan(ws, (w) => {
      if (w === "--delete") del = true;
      else if (w === "--force") force = true;
      else if (w === "-D") del = force = true;
      else if (w.startsWith("--")) return;
      else if (w.startsWith("-")) {
        if (w.includes("D")) del = force = true;
        if (w.includes("d")) del = true;
        if (w.includes("f")) force = true;
      } else named.push(w);
    });
    if (!(del && force)) continue;
    if (hidden) refuse("branch-unmerged", HIDDEN);
    for (const name of named) {
      if (!mergedTip(dir, name, `refs/heads/${name}`)) refuse("branch-unmerged", `BLOCKED: deleting branch ${name}: ${NOT_MERGED}`);
    }
  }
}

if (new RegExp(String.raw`${GIT}push\b${ARGS}(?:${S}(?:-d|--delete)(?:${S}|$)|${S}:\S)`, "m").test(stripped)) {
  const dir = targetDir();
  for (const ws of cut("push")) {
    let del = false;
    const positionals = [];
    const hidden = scan(ws, (w) => {
      if (w === "-d" || w === "--delete") del = true;
      else if (!w.startsWith("-")) positionals.push(w);
    });
    if (hidden) refuse("branch-unmerged", HIDDEN);
    const [remote, ...refs] = positionals;
    for (let ref of refs) {
      if (ref.startsWith(":")) ref = ref.slice(1);
      else if (!del) continue;
      ref = ref.replace(/^refs\/heads\//, "");
      if (!mergedTip(dir, ref, `refs/remotes/${remote}/${ref}`)) refuse("branch-unmerged", `BLOCKED: deleting remote branch ${remote}/${ref}: ${NOT_MERGED}`);
    }
  }
}

/* -- publish, filesystem, the repository's own denials ---------------------- */

if (guard.publishBan && has(String.raw`${POS}(?:npm|pnpm)${S}+(?:${ARGS}${S})?publish(?:${S}|$)`)) {
  refuse("publish", "BLOCKED: publish. A published version can never be taken back. Ask the user to publish it (guard.publishBan).");
}

if (has(String.raw`rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(?:/|\.|\.\.|~|\$HOME)(?:\s|$)`)) {
  refuse("rm-rf", "BLOCKED: recursive rm of a root, the current directory or home. Ask the user for explicit confirmation before running it.");
}

for (const { pattern, flags, reason } of guard.extraDeny) {
  if (new RegExp(pattern, `u${flags}`).test(command)) refuse("extra-deny", `BLOCKED: ${reason}`);
}

/* -- a push needs the gates -------------------------------------------------- */

// Every pushed ref's tip must be listed in the record the gates runner writes
// (one sha per line, in the git common directory) or already be on
// origin/<integration>. Tags, deletions and dry runs are not commits to gate.
if (gates.requireBeforePush && gates.run.length && pushes.length) {
  const dir = targetDir();
  const common = git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const file = common && path.join(common, gates.record);
  const recorded = file && existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  const missing = [];
  for (const ws of pushes) {
    if (ws.some((w) => w === "-d" || w === "--delete" || w === "-n" || w === "--dry-run" || w === "--tags")) continue;
    const [, ...specs] = positional(ws);
    let refs = specs.length ? specs : ["HEAD"];
    if (ws.includes("--all") || ws.includes("--mirror")) {
      refs = (git(dir, "for-each-ref", "--format=%(refname)", "refs/heads") ?? "").split("\n").filter(Boolean);
    }
    for (const spec of refs) {
      const src = spec.replace(/^\+/, "").split(":")[0];
      if (!src || src.startsWith("refs/tags/") || succeeds(dir, "show-ref", "--verify", "--quiet", `refs/tags/${src}`)) continue;
      const sha = git(dir, "rev-parse", "-q", "--verify", `${src}^{commit}`);
      if (!sha || recorded.includes(sha)) continue;
      if (succeeds(dir, "merge-base", "--is-ancestor", sha, `origin/${integration}`)) continue;
      missing.push(`${sha.slice(0, 7)} (${src})`);
    }
  }
  if (missing.length) {
    refuse("push-gates", `BLOCKED: the gates have not passed on ${missing.join(", ")}. Run the gates on the clean tree of that commit (the gates skill), then push again. Only the user skips them (gates.requireBeforePush).`);
  }
}

process.exit(0);
