#!/usr/bin/env node
/**
 * SessionStart and SessionEnd, off unless `reap.enabled`: stops the process
 * groups sessions left running in this repository (`lib/reap.mjs` says which).
 *
 * At SessionStart it sweeps: a group of a session that is gone, held by
 * nobody. It runs on every `source`, `compact` included (a plugin's
 * SessionStart has no matcher), and that is right: the sweep never reaches a
 * live session's group, so a second run finds what the first left, or
 * nothing.
 *
 * At SessionEnd the ending session's own groups go, held or not, unless the
 * reason is `clear` or `resume`: the Claude Code process lives on then, and
 * its groups go at its real end. A plugin's SessionEnd hook has 1.5 seconds
 * whatever its `timeout` (harness fact 28), less than a SIGTERM may need, so
 * the hook reads the groups of the session's process and of its ancestors,
 * starts this same script detached, `--end <session> <root> <groups>`, and
 * returns at once. The ending session is `CLAUDE_PID`, which Claude Code sets
 * for hook commands.
 *
 * A failure stops nothing and never fails the session.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { checkoutsOf, lineageGroups, orphanGroups, processTable, reap, systemReads } from "../lib/reap.mjs";

/** Stops what `session` left, or what nobody holds when it is undefined; the line that says so, or "". */
async function sweep(root, session, held = []) {
  const { reap: settings } = loadConfig({ cwd: root });
  if (!settings.enabled) return "";
  const groups = orphanGroups({ checkouts: checkoutsOf(root), session, keep: settings.keep, held }, systemReads);
  const stopped = await reap(groups);
  if (stopped.length === 0) return "";
  const where = [...new Set(stopped.map(({ directory }) => path.relative(path.dirname(root), directory) || directory))];
  return `stickler reap: stopped ${stopped.length} process group(s) ${session ? "this session left" : "nobody held"}, in ${where.join(", ")}.\n`;
}

/** The hook's run; what it says on stderr at session end is for the debug log and the tests. */
async function main() {
  if (process.argv[2] === "--end") {
    const [, , , session, root, held = ""] = process.argv;
    await sweep(root, Number(session), held.split(",").filter(Boolean).map(Number));
    return;
  }
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const { root, reap: settings } = loadConfig({ cwd: input.cwd || process.cwd() });
  if (!settings.enabled) return;
  if (input.hook_event_name !== "SessionEnd") {
    process.stdout.write(await sweep(root, undefined));
    return;
  }
  const pid = Number.parseInt(process.env.CLAUDE_PID ?? "", 10);
  if (["clear", "resume"].includes(input.reason)) {
    process.stderr.write(`stickler reap: the session goes on (${input.reason}); nothing stopped.\n`);
    return;
  }
  // 0 or 1 is no session: as one, it would own every process nobody started.
  if (!(pid > 1)) return;
  // Read now, while the session's process is surely there: the detached run
  // may start after it has gone, and must still never stop its group.
  const held = lineageGroups(processTable(), [process.pid, pid]);
  spawn(process.execPath, [fileURLToPath(import.meta.url), "--end", String(pid), root, held.join(",")], {
    detached: true,
    stdio: "ignore",
  }).unref();
  process.stderr.write("stickler reap: stopping this session's groups in the background.\n");
}

try {
  await main();
} catch (e) {
  process.stderr.write(`stickler reap: ${e.message}\n`);
}
