/**
 * Readers of what a document states, for a test that holds a value in code
 * to the document that repeats it: read both sides, never copy one into the
 * test. Each reader throws when what it was asked for is not there, so a
 * renamed heading or column fails the fact that read it instead of comparing
 * an empty list. docs/doc-facts.md says how to use them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { findRoot } from "./config.mjs";

/** A document's text, by its path from the repository root. */
export const readDoc = (relative, root = findRoot()) => readFileSync(path.join(root, relative), "utf8");

/** The passage under a heading (its text without `#`s), up to the next heading of its level or above. */
export function section(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^#{1,6} /u.test(line) && line.replace(/^#+ /u, "") === heading);
  if (start === -1) throw new Error(`no heading "${heading}"`);
  const level = /^#+/u.exec(lines[start])[0].length;
  const end = lines.findIndex((line, i) => i > start && (/^#+(?= )/u.exec(line)?.[0].length ?? 7) <= level);
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

/** The top-level items of the first list in `text`, wrapped lines folded into one. */
export function listItems(text) {
  const items = [];
  let started = false;
  for (const line of text.split("\n")) {
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/u.exec(line);
    if (item) {
      items.push(item[1].trim());
      started = true;
    } else if (started && /^\s+\S/u.test(line)) {
      // A nested item or a wrapped line belongs to the item above.
      items[items.length - 1] += ` ${line.trim()}`;
    } else if (started && line.trim() !== "") break;
  }
  if (items.length === 0) throw new Error("no list");
  return items;
}

const cells = (row) =>
  row
    .trim()
    .replace(/^\||\|$/gu, "")
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim().replaceAll("\\|", "|"));

/** A cell that is one code span, as its content; any other cell as written. */
export const plain = (cell) => (/^`[^`]+`$/u.test(cell) ? cell.slice(1, -1) : cell);

/** The header and body rows, as raw cells, of the first table of `text` that has the column `header`. */
export function table(text, header) {
  const lines = text.split("\n").map((line) => line.trim());
  for (const [i, line] of lines.entries()) {
    if (!line.startsWith("|") || !cells(line).includes(header)) continue;
    if (!/^\|[\s:|-]+\|$/u.test(lines[i + 1] ?? "")) continue;
    const body = [];
    for (const row of lines.slice(i + 2)) {
      if (!row.startsWith("|")) break;
      body.push(cells(row));
    }
    return { header: cells(line), rows: body };
  }
  throw new Error(`no table with the column "${header}"`);
}

/** The cells under `header`, each read with `plain`. */
export function column(text, header) {
  const { header: names, rows } = table(text, header);
  const at = names.indexOf(header);
  return rows.map((row) => plain(row[at] ?? ""));
}

/** The cell under `header` in the row whose first cell, read with `plain`, is `key`. */
export function cell(text, header, key) {
  const { header: names, rows } = table(text, header);
  const row = rows.find((r) => plain(r[0]) === key);
  if (!row) throw new Error(`no row "${key}" in the table with the column "${header}"`);
  return plain(row[names.indexOf(header)] ?? "");
}

/** The contents of every code span in `text`, in order. */
export const codeSpans = (text) => [...text.matchAll(/`([^`\n]+)`/gu)].map(([, span]) => span);

/** The paragraph that contains `needle`, on one line. */
export function paragraphWith(text, needle) {
  const found = text.split(/\n\s*\n/u).find((p) => p.includes(needle));
  if (found === undefined) throw new Error(`no paragraph says "${needle}"`);
  return found.replace(/\s*\n\s*/gu, " ");
}

// shortcut: English number words only; add a vocabulary when a document in another language states a number.
const words = {
  a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};

/** A number as a document writes it: `200`, `6,000`, `seven`, `forty-eight`, `a thousand`. */
export function numberOf(token) {
  const text = token.trim().toLowerCase();
  if (/^\d[\d,]*(?:\.\d+)?$/u.test(text)) return Number(text.replaceAll(",", ""));
  const parts = text.split(/[\s-]+/u).map((w) => words[w]);
  const [head, tail] = parts;
  if (head === undefined || parts.length > 2 || (parts.length === 2 && tail === undefined)) {
    throw new Error(`not a number: "${token}"`);
  }
  if (tail === undefined) return head;
  return head >= 20 && head < 100 && tail < 10 ? head + tail : head * tail;
}
