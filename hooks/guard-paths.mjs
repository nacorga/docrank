#!/usr/bin/env node
/**
 * PreToolUse on Edit|Write: refuses an edit to a file nobody should write by
 * hand, and names what to do instead, so the model learns the way round
 * rather than only being told no. The built-ins (`paths.builtIns`) are the
 * secrets and the lockfiles; `paths.rules` is what the repository adds.
 *
 * Between refusing and passing it asks. A change to an existing file that
 * holds the work to its checks (lint, format, type-check and commit-lint
 * configuration, git hooks, Claude Code hooks and settings) can weaken them,
 * and whether to is the user's call, so the user is prompted (harness fact
 * 29). Creating such a file passes: it replaces nothing that held. The
 * built-ins (`paths.askBuiltIns`) are those kinds; `paths.ask` is what the
 * repository adds. Anything else, and any file outside the repository,
 * passes silently.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { configFor, decide, deny, readInput } from "../lib/hook.mjs";

const input = await readInput();
const target = input.tool_input?.file_path;
if (!target) process.exit(0);
const { root, paths } = configFor(input);

const file = path.relative(root, path.resolve(root, target));
if (file === ".." || file.startsWith(`..${path.sep}`)) process.exit(0);
const name = path.basename(file);

const builtIns = [
  {
    hit: name === ".env" || (name.startsWith(".env.") && name !== ".env.example"),
    reason:
      "an .env file holds local secrets and is never edited by Claude. Document a new variable in .env.example (name and what it wants, no value) and tell the user what to set.",
  },
  {
    hit: ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"].includes(name),
    reason: "a lockfile is written by the package manager, never by hand. Change the manifest and run the install.",
  },
];

const isTracked = () => {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", file], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const posix = file.split(path.sep).join("/");
const hit =
  (paths.builtIns && builtIns.find((rule) => rule.hit)) ||
  paths.rules.find((rule) => new RegExp(rule.pattern, "u").test(posix) && (!rule.onlyIfTracked || isTracked()));
if (hit) deny(`${posix}: ${hit.reason}`);

/* Each kind of file that holds the work to its checks, by where it lives. */
const enforcing = [
  {
    kind: "a lint configuration",
    pattern: /(^|\/)(\.eslintrc(\.[a-z]+)?|eslint\.config\.[cm]?[jt]s|\.eslintignore|\.oxlintrc(\.jsonc?)?|oxlint\.config\.[cm]?[jt]s)$/u,
  },
  { kind: "a lint and formatter configuration", pattern: /(^|\/)\.?biome\.jsonc?$/u },
  {
    kind: "a formatter configuration",
    pattern: /(^|\/)(\.prettierrc(\.[a-z0-9]+)?|prettier\.config\.[cm]?[jt]s|\.prettierignore)$/u,
  },
  { kind: "a type-check configuration", pattern: /(^|\/)tsconfig[^/]*\.json$/u },
  {
    kind: "a commit-lint configuration",
    pattern: /(^|\/)(\.commitlintrc(\.[a-z]+)?|commitlint\.config\.[cm]?[jt]s)$/u,
  },
  { kind: "a git hook", pattern: /(^|\/)\.(githooks|husky)\//u },
  { kind: "a Claude Code hook", pattern: /(^|\/)(\.claude\/hooks\/|hooks\/hooks\.json$)/u },
  { kind: "Claude Code settings", pattern: /(^|\/)\.claude\/settings(\.local)?\.json$/u },
];

const ask = (reason) => decide({ permissionDecision: "ask", permissionDecisionReason: `${posix}: ${reason}` });

if (!existsSync(path.join(root, file))) process.exit(0);
const kind = paths.askBuiltIns && enforcing.find((rule) => rule.pattern.test(posix));
if (kind) {
  ask(
    `${kind.kind} holds the work to its checks, and changing it can weaken them. Whether to is the user's call, not the session's.`,
  );
}
const rule = paths.ask.find((r) => new RegExp(r.pattern, "u").test(posix));
if (rule) ask(rule.reason);
