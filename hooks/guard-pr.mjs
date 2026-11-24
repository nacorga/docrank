#!/usr/bin/env node
/**
 * PreToolUse on Bash: a `gh pr create` owes its handover (`pr.checklist`), so
 * the handover does not depend on a skill being read. It applies when the diff
 * touches `pr.productPaths` or `surface.paths`; for the latter the delivery
 * criterion (`surface.criterion`) is named too.
 *
 * What passes it is evidence when `pr.requiredLines` is set: the body, read
 * from the command (`--body`, `-b`, `--body-file`, `-F`), holds a line for
 * each entry that applies, and a body that lacks one is refused every time,
 * naming the missing. A bare entry applies to every diff the guard reads; an
 * entry with `paths` applies when the diff touches one of them, and a diff
 * that touches only those paths is read too. Without `pr.requiredLines`, or
 * when the diff touches product or surface paths but no entry is owed (every
 * entry has `paths` and none is touched), a refusal proves nothing the retry
 * does not, so the first `gh pr create` of a branch in a session is refused
 * once and the same branch again passes.
 *
 * It stays out of the way for a pull request into a base other than
 * `branches.integration` (a slice into a shared base is read once, at its
 * close), for a diff that touches neither list, and whenever git cannot answer.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { git } from "../lib/git.mjs";
import { configFor, deny, readInput } from "../lib/hook.mjs";

const POSITION = String.raw`(?:^|[;&|(]|&&|\|\|)\s*`;

const input = await readInput();
const command = String(input.tool_input?.command ?? "");
const create = new RegExp(`${POSITION}gh\\s+pr\\s+create\\b[^|&;]*`, "u").exec(command);
if (!create) process.exit(0);

const { branches, pr, surface } = configFor(input);
const lines = pr.requiredLines.map((entry) => (typeof entry === "string" ? { pattern: entry, paths: null } : entry));
if (pr.productPaths.length === 0 && surface.paths.length === 0 && lines.every((entry) => !entry.paths)) process.exit(0);

const base = /(?:--base|-B)[\s=]+(\S+)/u.exec(create[0])?.[1]?.replace(/["']/gu, "");
if (base && base !== branches.integration) process.exit(0);

const cwd = String(input.cwd ?? process.cwd());
/** The last `cd <dir>` before the command, as the shell would run it. */
const named = [...command.matchAll(new RegExp(`${POSITION}cd\\s+([^;&|]+)`, "gu"))].at(-1)?.[1]?.trim().replace(/["']/gu, "");
const resolved = named && path.resolve(cwd, named.replace(/^~/u, process.env.HOME));
const dir = resolved && existsSync(resolved) ? resolved : cwd;

const branch = git(dir, "rev-parse", "--abbrev-ref", "HEAD");
const changed = git(dir, "diff", "--name-only", `origin/${branches.integration}...HEAD`);
if (!branch || changed === null) process.exit(0);
const files = changed.split("\n");
const touches = (prefixes) => files.some((file) => prefixes.some((p) => file.startsWith(p)));
const product = touches(pr.productPaths);
const drawn = touches(surface.paths);
const owed = lines.filter((entry) => (entry.paths ? touches(entry.paths) : product || drawn));
if (!product && !drawn && owed.length === 0) process.exit(0);

if (owed.length > 0) {
  const body = bodyOf(command.slice(create.index + create[0].search(/gh\s+pr\s+create/u)), dir);
  const bodyLines = body === null ? [] : body.split(/\r?\n/u);
  const missing = owed.filter(({ pattern }) => !bodyLines.some((line) => new RegExp(pattern, "ium").test(line)));
  if (missing.length === 0) process.exit(0);
  const list = missing.map(({ pattern }) => `/${pattern}/`).join(", ");
  deny(
    [
      drawn && surface.criterion && `This pull request draws screens: each must meet the delivery criterion — ${surface.criterion} — read rendered.`,
      body === null
        ? `Its body is not in the command (--body, -b, --body-file or -F with a readable file), so these lines cannot be seen: ${list}.`
        : `Its body has no line matching ${list}.`,
      pr.checklist,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

const session = String(input.session_id ?? "none").replace(/[^\w-]/gu, "");
const seenFile = path.join(tmpdir(), `stickler-pr-handover-${session}`);
const seen = existsSync(seenFile) ? readFileSync(seenFile, "utf8") : "";
if (seen.split("\n").includes(branch)) process.exit(0);
appendFileSync(seenFile, `${branch}\n`);

deny(
  [
    drawn && surface.criterion && `This pull request draws screens: each must meet the delivery criterion — ${surface.criterion} — read rendered.`,
    pr.checklist,
  ]
    .filter(Boolean)
    .join(" "),
);

/**
 * The pull request body the command carries, or null when it carries none
 * that can be read: `--fill`, no body flag, `-` (stdin) or a file that is not
 * there. `text` starts at `gh pr create`; its words are read as a shell would
 * split them, up to the first unquoted `;`, `&`, `|` or newline.
 */
function bodyOf(text, from) {
  const words = shellWords(text);
  let body = null;
  for (const [i, word] of words.entries()) {
    const [flag, ...rest] = word.split("=");
    const inline = rest.length > 0 ? rest.join("=") : null;
    const value = inline ?? words[i + 1];
    if (value === undefined) continue;
    if (flag === "--body" || flag === "-b") body = value;
    else if (flag === "--body-file" || flag === "-F") body = value === "-" ? null : readBody(value, from);
  }
  return body;
}

function readBody(file, from) {
  try {
    return readFileSync(path.resolve(from, file.replace(/^~/u, process.env.HOME)), "utf8");
  } catch {
    return null;
  }
}

/**
 * Words of one shell command, quotes removed. A `$(…)`, inside double quotes
 * or outside, is kept verbatim to its matching `)`: the usual body is
 * `--body "$(cat <<'EOF' … EOF)"`, whose prose holds quotes and parens.
 */
function shellWords(text) {
  const words = [];
  let word = null;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else word += c;
    } else if (c === "$" && text[i + 1] === "(" && quote !== "'") {
      const end = substitutionEnd(text, i);
      word = (word ?? "") + text.slice(i, end);
      i = end - 1;
    } else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "\\" && '"\\$`'.includes(text[i + 1] ?? "")) word += text[++i];
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      word ??= "";
    } else if (c === "\\") {
      if (text[i + 1] !== "\n") word = (word ?? "") + (text[i + 1] ?? "");
      i++;
    } else if (/\s/u.test(c)) {
      if (c === "\n") break;
      if (word !== null) words.push(word);
      word = null;
    } else if (";&|".includes(c)) {
      break;
    } else {
      word = (word ?? "") + c;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

/**
 * The index just past the `)` that closes the `$(` at `start`. A heredoc
 * opened inside is read line by line to its terminator, quotes and parens
 * ignored; elsewhere quoted text is skipped and parens are counted.
 */
function substitutionEnd(text, start) {
  let depth = 0;
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"') {
      const close = text.indexOf(c, i + 1);
      i = close === -1 ? text.length : close + 1;
      continue;
    }
    const heredoc = c === "<" && text[i + 1] === "<" && /^<<(-?)\s*(["']?)([\w.-]+)\2/u.exec(text.slice(i, i + 80));
    if (heredoc) {
      const [opener, dash, , delimiter] = heredoc;
      let at = text.indexOf("\n", i + opener.length);
      while (at !== -1) {
        const next = text.indexOf("\n", at + 1);
        const line = text.slice(at + 1, next === -1 ? text.length : next);
        at = next;
        if ((dash ? line.replace(/^\t+/u, "") : line) === delimiter) break;
      }
      i = at === -1 ? text.length : at;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
    i++;
  }
  return text.length;
}
