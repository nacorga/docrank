/** What every PreToolUse hook of docrank shares: its input and its answer. */
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { writeOut } from "./stdio.mjs";
import { recordRefusal } from "./watch/record.mjs";

/* The input and config of this hook run, kept so that `deny` can tell docrank watch. */
const current = { input: null, config: null };

export async function readInput() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  current.input = JSON.parse(data || "{}");
  return current.input;
}

/** Prints a PreToolUse decision and ends the hook. */
export function decide(fields) {
  writeOut(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...fields } }));
  process.exit(0);
}

/** Refuses the call. A refusal fires no event watch sees (harness fact 21), so it is recorded here. */
export function deny(reason) {
  recordRefusal(current.input, current.config, reason, path.basename(process.argv[1] ?? "", ".mjs"));
  return decide({ permissionDecision: "deny", permissionDecisionReason: reason });
}

/**
 * The repository's config, read from the directory the hook fires in. A file
 * that does not validate refuses the call with its messages: a guard that went
 * quiet on a typo would let through what the repository configured it to hold.
 */
export function configFor(input) {
  try {
    current.config = loadConfig({ cwd: input.cwd || process.cwd() });
    return current.config;
  } catch (e) {
    return deny(`docrank: ${e.message}`);
  }
}
