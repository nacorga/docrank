#!/usr/bin/env node
/**
 * PostToolUse on Edit|Write: formats the edited file the way the repository's
 * own check will later see it (`format.command`), then lints it and reports,
 * never fixes, what the linter finds (`format.lintCommand`, for
 * `format.lintExtensions`): a rule that guards a design is meant to fail in
 * the model's face, and fixing it quietly would hide the error it exists to
 * catch. Exit 2 carries the lint output to the model.
 *
 * Only this repository's files are touched, another worktree of it included,
 * because a file of any other repository would be rewritten with a style its
 * owner never chose. A config that does not load is the guards' to refuse.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { readInput } from "../lib/hook.mjs";
import { writeErr } from "../lib/stdio.mjs";
import { loadConfig } from "../lib/config.mjs";

const input = await readInput();
const target = input.tool_input?.file_path;
if (!target) process.exit(0);

let config;
try {
  config = loadConfig({ cwd: input.cwd || process.cwd() });
} catch {
  process.exit(0);
}
const { root, format } = config;
if (!format.command && !format.lintCommand) process.exit(0);

const absolute = path.resolve(root, target);
const inside = path.relative(root, absolute);
const commonDir = (cwd) => {
  try {
    return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};
const ours = inside !== ".." && !inside.startsWith(`..${path.sep}`);
if (!ours && (!existsSync(path.dirname(absolute)) || commonDir(path.dirname(absolute)) !== commonDir(root))) process.exit(0);
if (!existsSync(absolute)) process.exit(0);

const file = ours ? inside : absolute;
const quoted = `'${file.replaceAll("'", "'\\''")}'`;
const exec = (command) => execSync(`${command} ${quoted} 2>&1`, { cwd: root, encoding: "utf8" });

if (format.command) {
  try {
    exec(format.command);
  } catch {
    // A formatter that fails leaves the file as it was; the lint below still speaks.
  }
}
if (format.lintCommand && format.lintExtensions.includes(path.extname(file))) {
  try {
    exec(format.lintCommand);
  } catch (e) {
    writeErr(`Lint on ${file}:\n${e.stdout ?? e.message}\n`);
    process.exit(2);
  }
}
