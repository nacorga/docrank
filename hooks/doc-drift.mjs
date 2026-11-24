#!/usr/bin/env node
/**
 * Stop: when the work since `docDrift.baseRef` changed code a document states
 * (`docDrift.entries`) and none of that document's files, it asks once per
 * session whether the document still holds. Code never wins, so the answer is
 * an edit to the document or one line saying it is unaffected.
 *
 * Silent when no entry is configured, when nothing mapped changed, when git or
 * the base ref is unavailable, and on every stop after the first ask.
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readInput } from "../lib/hook.mjs";
import { writeErr } from "../lib/stdio.mjs";
import { loadConfig } from "../lib/config.mjs";

const input = await readInput();
if (input.stop_hook_active) process.exit(0);

let config;
try {
  config = loadConfig({ cwd: input.cwd || process.cwd() });
} catch {
  process.exit(0);
}
const { root, docDrift } = config;
if (docDrift.entries.length === 0) process.exit(0);

const session = String(input.session_id ?? "none").replace(/[^\w-]/gu, "");
const marker = path.join(tmpdir(), `stickler-drift-${session}`);
if (existsSync(marker)) process.exit(0);

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
let changed;
try {
  const base = git("merge-base", "HEAD", docDrift.baseRef).trim();
  changed = [...git("diff", "--name-only", base).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")].filter(Boolean);
} catch {
  process.exit(0);
}

const touches = (prefixes) => changed.some((file) => prefixes.some((prefix) => file.startsWith(prefix)));
const stale = docDrift.entries.filter((entry) => touches(entry.code) && !touches(entry.docs));
if (stale.length === 0) process.exit(0);

writeFileSync(marker, "");
writeErr(
  [
    "Code a document states changed, and the document did not:",
    ...stale.map((entry) => `- ${entry.code.join(", ")} changed; ${entry.docs.join(", ")} did not`),
    "Check each still holds. Fix the document if not; if it is unaffected, say so in one line and finish.",
  ].join("\n") + "\n",
);
process.exit(2);
