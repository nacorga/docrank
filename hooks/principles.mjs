#!/usr/bin/env node
/**
 * SessionStart: injects the working principles, then the report language and
 * the closing line when configured. SessionStart runs again on resume, so the
 * text is the same every time. A config that does not validate says so on
 * stderr and injects nothing: a context hook must never block a session.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { readInput } from "../lib/hook.mjs";
import { loadConfig } from "../lib/config.mjs";
import { PLUGIN_ROOT } from "../lib/agent-types.mjs";

const input = await readInput();
let principles;
try {
  ({ principles } = loadConfig({ cwd: input.cwd || process.cwd() }));
} catch (e) {
  process.stderr.write(`docrank: ${e.message}\n`);
  process.exit(0);
}
if (!principles.enabled) process.exit(0);

const text = [readFileSync(path.join(PLUGIN_ROOT, "principles", "principles.md"), "utf8").trim()];
text.push(`Hand-over messages and reports are written in ${principles.reportLanguage}.`);
if (principles.closingLine) {
  text.push(
    `Every message that hands something to the user ends with one line, "${principles.closingLine}", naming exactly what the user does next, or saying nothing is pending on their side.`,
  );
}
process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text.join("\n\n") } }),
);
