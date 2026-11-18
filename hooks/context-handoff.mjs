#!/usr/bin/env node
/**
 * Stop: once a session's context passes `handoff.tokenThreshold`, has Claude
 * write the hand-off while the conversation is still cached. It fires once per
 * context cycle: a compaction drops the context, which re-arms it for the next
 * climb. Closing the session stays the user's decision.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readInput } from "../lib/hook.mjs";
import { loadConfig } from "../lib/config.mjs";

const input = await readInput();
if (input.stop_hook_active) process.exit(0);
const { transcript_path: transcript, session_id: id } = input;
if (!transcript || !id || !existsSync(transcript)) process.exit(0);

let handoff;
try {
  ({ handoff } = loadConfig({ cwd: input.cwd || process.cwd() }));
} catch {
  process.exit(0);
}
if (!handoff.enabled) process.exit(0);

// The context of the last main-thread call is what the next turn re-reads.
let tokens;
for (const line of readFileSync(transcript, "utf8").split("\n").filter(Boolean).slice(-400)) {
  try {
    const entry = JSON.parse(line);
    const usage = entry.type === "assistant" && !entry.isSidechain ? entry.message?.usage : null;
    if (usage) tokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  } catch {
    // a half-written line
  }
}
if (tokens === undefined) process.exit(0);

// Outside the temp directory, which macOS empties on its own schedule.
const dir = path.join(homedir(), ".claude", "state", "docrank-handoff");
mkdirSync(dir, { recursive: true });
for (const file of readdirSync(dir)) {
  const old = path.join(dir, file);
  if (Date.now() - statSync(old).mtimeMs > 7 * 864e5) unlinkSync(old);
}
const state = path.join(dir, String(id).replace(/[^\w-]/gu, ""));

// "<fired> <tokens at the last stop>"; a drop in tokens is a compaction.
let [fired, last] = existsSync(state) ? readFileSync(state, "utf8").trim().split(" ").map(Number) : [0, 0];
if (tokens < last) fired = 0;

if (tokens < handoff.tokenThreshold || fired === 1) {
  writeFileSync(state, `${fired} ${tokens}`);
  process.exit(0);
}
writeFileSync(state, `1 ${tokens}`);

const where =
  handoff.location === "plan"
    ? "the § Handoff section of the plan this work follows, wherever that plan lives; with no plan, where this project keeps its state"
    : `${handoff.location}`;
process.stdout.write(
  JSON.stringify({
    decision: "block",
    reason: `The context is at ${Math.floor(tokens / 1000)}k tokens; every turn re-reads all of it. Before stopping, write the hand-off into ${where}. Never in a scratchpad or a temporary directory. The hand-off holds what is done, what remains, the decisions closed so they are not asked again, the files touched, how to verify, and every subagent or watcher still running, by its name or ID. Change nothing else. If there is no work in progress, write nothing. If the plan has items left and nothing runs in the background, end your message with one line proposing \`/clear\` in this same window and the exact text to paste after it. If anything runs in the background, propose no cut. Otherwise say nothing to the user about the context or the hand-off: auto-compact takes it from here.`,
  }),
);
