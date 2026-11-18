#!/usr/bin/env node
/**
 * PreToolUse on MCP tools: a message leaves only after its claims were
 * checked. The tools that count are `messages.tools`; a hook matcher in
 * hooks.json is static, so it admits every MCP tool and the filter is here.
 *
 * The first call with a given input is refused with `messages.checklist`; the
 * same input sent again passes, so the check costs one round trip and a
 * changed message asks for it again. What was seen is kept per session in the
 * system's temporary directory, by hash, never the message.
 */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { configFor, deny, readInput } from "../lib/hook.mjs";

const input = await readInput();
const { messages } = configFor(input);
if (!messages.tools.some((pattern) => new RegExp(pattern, "u").test(input.tool_name ?? ""))) process.exit(0);

const digest = createHash("sha256").update(JSON.stringify(input.tool_input ?? {})).digest("hex");
const session = String(input.session_id ?? "none").replace(/[^\w-]/gu, "");
const seenFile = path.join(tmpdir(), `docrank-message-${session}`);

let seen = "";
try {
  seen = readFileSync(seenFile, "utf8");
} catch {
  seen = "";
}
if (seen.split("\n").includes(digest)) process.exit(0);
appendFileSync(seenFile, `${digest}\n`);
deny(messages.checklist);
