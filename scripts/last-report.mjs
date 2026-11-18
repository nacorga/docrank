#!/usr/bin/env node
/**
 * Prints the last thing a subagent said: its last text, or the last message it
 * handed back with SubagentHandback or sent with SendMessage. A subagent's
 * report is its final message, and that message is not guaranteed to arrive;
 * the transcript Claude Code keeps of it always does.
 *
 *   node scripts/last-report.mjs <transcript.jsonl>
 *
 * The transcript is the output file the Agent call names, or the agent's
 * `subagents/agent-<id>.jsonl` beside the session's own transcript.
 */
import { existsSync, readFileSync } from "node:fs";

const [file, ...extra] = process.argv.slice(2);
if (!file || extra.length || !existsSync(file)) {
  process.stderr.write("usage: last-report.mjs <transcript.jsonl>\n");
  process.exit(2);
}

let report;
for (const line of readFileSync(file, "utf8").split("\n")) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue; // a line still being written, or blank
  }
  if (entry?.type !== "assistant" || !Array.isArray(entry.message?.content)) continue;
  for (const block of entry.message.content) {
    if (block.type === "text") report = block.text;
    else if (block.type === "tool_use" && ["SubagentHandback", "SendMessage"].includes(block.name)) {
      const message = block.input?.message;
      report = typeof message === "string" ? message : JSON.stringify(message ?? null);
    }
  }
}

if (!report) {
  process.stderr.write(`No message in ${file}: the agent has said nothing yet.\n`);
  process.exit(1);
}
process.stdout.write(`${report}\n`);
