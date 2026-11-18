#!/usr/bin/env node
/**
 * PreToolUse on Edit|Write: refuses an edit to a file nobody should write by
 * hand, and names what to do instead, so the model learns the way round
 * rather than only being told no. The built-ins (`paths.builtIns`) are the
 * secrets and the lockfiles; `paths.rules` is what the repository adds.
 * Anything else, and any file outside the repository, passes silently.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { configFor, deny, readInput } from "../lib/hook.mjs";

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
