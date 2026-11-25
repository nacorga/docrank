#!/usr/bin/env node
/**
 * PreToolUse on MCP tools: a message leaves only after its claims were
 * checked. The tools that count are `messages.tools`; a hook matcher in
 * hooks.json is static, so it admits every MCP tool and the filter is here.
 *
 * What passes it is evidence when `messages.evidenceHeader` is set: since the
 * last user prompt, the session's transcript (`transcript_path`, JSONL) holds
 * a Markdown table whose header row matches it, in an assistant text or in
 * the input of an earlier tool call that ran (a Write of a file, say). Reply
 * text written before a call may never reach the transcript whole (fact 24 of
 * docs/harness-facts.md), and the input of a call that ran always has, so the
 * refusal asks for the table through a tool. A transcript that is read and
 * holds no such table is proof that none was written: the call is refused
 * every time, naming what is missing, until one is.
 *
 * Without a key, or with a transcript that is absent, unreadable or not JSONL
 * of the shape fact 24 records, a refusal proves nothing the retry does not:
 * the first call with a given input is refused with `messages.checklist`, the
 * same input sent again passes, and a changed message asks again. What was
 * seen is kept per session in the system's temporary directory, by hash,
 * never the message.
 */
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { configFor, deny, readInput } from "../lib/hook.mjs";

/** The last bytes are read first; the whole file only when they hold no user prompt. */
const TAIL = 512 * 1024;

const input = await readInput();
const { messages } = configFor(input);
if (!messages.tools.some((pattern) => new RegExp(pattern, "u").test(input.tool_name ?? ""))) process.exit(0);

const header = messages.evidenceHeader;
const written = header ? tableWritten(input.transcript_path, header) : null;
if (written === true) process.exit(0);
if (written === false)
  deny(
    `${messages.checklist} Missing: a Markdown table whose header row matches /${header}/i, written since the last prompt and before this call. ` +
      "Write it with a tool, e.g. Write to a scratch file: reply text before a call may not reach the transcript.",
  );

const digest = createHash("sha256").update(JSON.stringify(input.tool_input ?? {})).digest("hex");
const session = String(input.session_id ?? "none").replace(/[^\w-]/gu, "");
const seenFile = path.join(tmpdir(), `stickler-message-${session}`);

let seen = "";
try {
  seen = readFileSync(seenFile, "utf8");
} catch {
  seen = "";
}
if (seen.split("\n").includes(digest)) process.exit(0);
appendFileSync(seenFile, `${digest}\n`);
deny(messages.checklist);

/**
 * Whether, since the last user prompt, an assistant text or the input of a
 * tool call that ran holds a table header matching `header`: true or false,
 * or null when the transcript cannot be read as JSONL of `type` and
 * `message.content`, or holds no prompt to measure from. A call ran when its
 * `tool_result` is no error: a refused call, this guard's own included, and
 * the call in flight count for nothing.
 */
function tableWritten(transcript, header) {
  if (typeof transcript !== "string" || transcript === "") return null;
  const pattern = new RegExp(header.normalize("NFC"), "iu");
  for (const limit of [TAIL, Infinity]) {
    const read = readLines(transcript, limit);
    if (read === null) return null;
    const texts = [];
    // Read backwards, a call's result comes before the call itself.
    const ran = new Set();
    for (const line of read.lines.reverse()) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return null;
      }
      if (entry?.isSidechain) continue;
      const content = entry?.message?.content;
      const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
      if (entry?.type === "user") {
        if (isPrompt(entry, blocks)) return texts.some((text) => hasHeader(text, pattern));
        for (const block of blocks) if (block?.type === "tool_result" && !block.is_error) ran.add(block.tool_use_id);
      } else if (entry?.type === "assistant") {
        for (const block of blocks) {
          if (block?.type === "text") texts.push(block.text);
          else if (block?.type === "tool_use" && ran.has(block.id)) texts.push(...strings(block.input));
        }
      }
    }
    // No prompt in what was read: a header seen is after the last prompt, whichever it was.
    if (texts.some((text) => hasHeader(text, pattern))) return true;
    if (read.whole) return null;
  }
  return null;
}

/** Every string inside a tool input, at any depth. */
function strings(value) {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** The non-empty lines of the file's last `limit` bytes, whole lines only; null when it cannot be read. */
function readLines(file, limit) {
  let fd;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - limit);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    return { lines: lines.filter(Boolean), whole: start === 0 };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * A user entry that is the person's prompt: it holds text, is not `isMeta`
 * (peer messages, subagent hand-backs) and, when it names an `origin`, that is
 * `human` (a background task's notification is not). An entry with no
 * `origin` still counts, the safe side: it asks for the table again.
 */
function isPrompt(entry, blocks) {
  if (!blocks.some((block) => block?.type === "text") || entry.isMeta) return false;
  return !entry.origin || entry.origin.kind === "human";
}

/** A line of `text` that is a table header matching `pattern`: a `|` row, then the `---` row under it. */
function hasHeader(text, pattern) {
  const rows = String(text).normalize("NFC").split("\n").map((row) => row.trim());
  return rows.some((row, i) => row.startsWith("|") && pattern.test(row) && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/u.test(rows[i + 1] ?? ""));
}
