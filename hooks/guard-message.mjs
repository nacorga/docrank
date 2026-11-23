#!/usr/bin/env node
/**
 * PreToolUse on MCP tools: a message leaves only after its claims were
 * checked. The tools that count are `messages.tools`; a hook matcher in
 * hooks.json is static, so it admits every MCP tool and the filter is here.
 *
 * What passes it is evidence when `messages.evidenceHeader` is set: the
 * session's transcript (`transcript_path`, JSONL) holds, in an assistant text
 * since the last user prompt, a Markdown table whose header row matches it.
 * Then the call passes at the first attempt, and a transcript that is read
 * and holds no such table is refused every time, with `messages.checklist` and
 * what is missing.
 *
 * Without the key, or when the transcript is absent, unreadable or not
 * JSONL of the shape fact 24 of docs/harness-facts.md records, a refusal
 * proves nothing the retry does not: the first call with a given input is
 * refused with `messages.checklist`, the same input sent again passes, and a
 * changed message asks again. What was seen is kept per session in the
 * system's temporary directory, by hash, never the message.
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
if (written === false) {
  deny(`${messages.checklist} Missing: a Markdown table, written in this turn before the call, whose header row matches /${header}/i.`);
}

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

/**
 * Whether an assistant text since the last user prompt holds a table header
 * matching `header`: true or false, or null when the transcript cannot be read
 * as JSONL of `type` and `message.content`, or holds no prompt to measure from.
 */
function tableWritten(transcript, header) {
  if (typeof transcript !== "string" || transcript === "") return null;
  const pattern = new RegExp(header, "iu");
  for (const limit of [TAIL, Infinity]) {
    const read = readLines(transcript, limit);
    if (read === null) return null;
    const texts = [];
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
        if (blocks.some((block) => block?.type === "text")) return texts.some((text) => hasHeader(text, pattern));
      } else if (entry?.type === "assistant") {
        for (const block of blocks) if (block?.type === "text") texts.push(block.text);
      }
    }
    // No prompt in what was read: a header seen is after the last prompt, whichever it was.
    if (texts.some((text) => hasHeader(text, pattern))) return true;
    if (read.whole) return null;
  }
  return null;
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

/** A line of `text` that is a table header matching `pattern`: a `|` row, then the `---` row under it. */
function hasHeader(text, pattern) {
  const rows = String(text).split("\n").map((row) => row.trim());
  return rows.some((row, i) => row.startsWith("|") && pattern.test(row) && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/u.test(rows[i + 1] ?? ""));
}
