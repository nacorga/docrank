#!/usr/bin/env node
/**
 * SessionStart, off unless `memory.link`: points Claude Code's memory directory
 * for this session's project at the repository's tracked `.claude/memory`, so
 * every memory written lands in `git status` and is reviewed like any change.
 *
 * The project directory is the one holding the session's transcript, not a
 * slug computed here: how Claude Code names it is not documented. Anything
 * that does not look like `<...>/.claude/projects/<dir>` is refused and said.
 *
 * Memories are never deleted: a real directory holding files is moved aside.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, rmdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { readInput } from "../lib/hook.mjs";
import { loadConfig } from "../lib/config.mjs";

const input = await readInput();
let config;
try {
  config = loadConfig({ cwd: input.cwd || process.cwd() });
} catch {
  process.exit(0);
}
if (!config.memory.link) process.exit(0);

const say = (message) => process.stdout.write(`stickler memory: ${message}\n`);

const projectDir = input.transcript_path ? path.dirname(input.transcript_path) : "";
const parent = path.dirname(projectDir);
if (!projectDir || path.basename(parent) !== "projects" || path.basename(path.dirname(parent)) !== ".claude") {
  say(`not linked: ${input.transcript_path || "no transcript_path"} is not under a Claude projects directory (<...>/.claude/projects/<project>/).`);
  process.exit(0);
}

// The main checkout, from any worktree: memories are written to one copy.
let common;
try {
  common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: input.cwd || process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  process.exit(0);
}
const canonical = path.join(path.dirname(common), ".claude", "memory");
if (!existsSync(canonical)) process.exit(0);

const target = path.join(projectDir, "memory");
const info = lstatSync(target, { throwIfNoEntry: false });
if (info?.isSymbolicLink() && readlinkSync(target) === canonical) process.exit(0);

if (info?.isDirectory()) {
  if (readdirSync(target).length === 0) rmdirSync(target);
  else {
    const aside = `${target}.orphan-${new Date().toISOString().replace(/\D/gu, "").slice(0, 14)}`;
    renameSync(target, aside);
    say(`unlinked memories moved aside to ${aside}; merge them into .claude/memory by hand.`);
  }
}
rmSync(target, { force: true });
mkdirSync(projectDir, { recursive: true });
symlinkSync(canonical, target);
say(`${target} now writes to ${canonical}, tracked in git.`);
