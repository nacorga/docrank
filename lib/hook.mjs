/** What every PreToolUse hook of docrank shares: its input and its answer. */
import { loadConfig } from "./config.mjs";

export async function readInput() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data || "{}");
}

/** Prints a PreToolUse decision and ends the hook. */
export function decide(fields) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...fields } }));
  process.exit(0);
}

export const deny = (reason) => decide({ permissionDecision: "deny", permissionDecisionReason: reason });

/**
 * The repository's config, read from the directory the hook fires in. A file
 * that does not validate refuses the call with its messages: a guard that went
 * quiet on a typo would let through what the repository configured it to hold.
 */
export function configFor(input) {
  try {
    return loadConfig({ cwd: input.cwd || process.cwd() });
  } catch (e) {
    return deny(`docrank: ${e.message}`);
  }
}
