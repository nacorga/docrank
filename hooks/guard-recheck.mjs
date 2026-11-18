#!/usr/bin/env node
/**
 * The re-check limit of a judge's review, `judges.maxRechecks`
 * (skills/judge-protocol, § The caller). Left to the protocol's text, judges
 * were still resumed past it, with the session waiting behind each round.
 *
 * PostToolUse on Agent records the type of each agent dispatched, by the
 * `agentId` the dispatch returned and by its `name`. PreToolUse on
 * SendMessage reads that record: `to` is an agent ID or a name, and the hook
 * input's own `agent_type` names the sender, never the recipient
 * (docs/harness-facts.md, fact 12). An agent with no record is not held.
 *
 * A message to a judge past the limit is refused once. Not every message is a
 * re-check, so the same call again goes through: the session answers for it,
 * and a changed message is refused anew. The record is kept per session in
 * the system's temporary directory, as types, counts and hashes, never the
 * message.
 */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isJudgeType } from "../lib/agent-types.mjs";
import { configFor, deny, readInput } from "../lib/hook.mjs";

const input = await readInput();
const session = String(input.session_id ?? "none").replace(/[^\w-]/gu, "");
const stateFile = path.join(tmpdir(), `docrank-recheck-${session}`);
const word = (value) => (/^[\w:.-]+$/u.test(String(value ?? "")) ? String(value) : undefined);
const tool = input.tool_input ?? {};

if (input.hook_event_name === "PostToolUse") {
  const type = word(tool.subagent_type ?? "general-purpose");
  const id = word(input.tool_response?.agentId);
  const name = word(tool.name);
  // A name is recorded with the ID it reaches, so both count as one agent.
  if (type && id) appendFileSync(stateFile, `agent ${id} ${type} ${id}\n`);
  if (type && name) appendFileSync(stateFile, `agent ${name} ${type} ${id ?? name}\n`);
  process.exit(0);
}

let state = [];
try {
  state = readFileSync(stateFile, "utf8").split("\n");
} catch {
  state = [];
}
const to = word(tool.to);
const [, , type, agent] = (to && state.findLast((line) => line.startsWith(`agent ${to} `))?.split(" ")) || [];
if (!type) process.exit(0);
const config = configFor(input);
if (!isJudgeType(type, config.root, config.judges.skill)) process.exit(0);

const limit = config.judges.maxRechecks;
const digest = createHash("sha256").update(JSON.stringify(tool)).digest("hex");
const sent = state.filter((line) => line === `sent ${agent}`).length;
if (sent >= limit && !state.includes(`refused ${digest}`)) {
  appendFileSync(stateFile, `refused ${digest}\n`);
  deny(
    `${to} (${type}) has had ${limit} messages since its dispatch, and ${limit} re-checks close a judge's review (docrank \`judges.maxRechecks\`): no further re-check is dispatched (judge-protocol § The caller). A finding still open, and anything that changed the judge's ground since, a rebase included, is this session's: fix it and prove it by its own measurement, or drop it with its reason in the commit body. If this message is no re-check, or fewer than ${limit} of those were, send it again unchanged.`,
  );
}
appendFileSync(stateFile, `sent ${agent}\n`);
