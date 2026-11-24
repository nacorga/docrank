#!/usr/bin/env node
/**
 * Every section reference written under `docs.scanRoots` — a document's
 * name, then `§` and a heading — names a heading of the document it cites.
 * A reference is a promise nothing else keeps: a heading renamed or a
 * section moved leaves it pointing at nothing, and the reader who follows it
 * finds out. History (`docs.historyRoots`) is neither
 * scanned nor held as a target: a dated document cites the tree as it was.
 *
 * A reference is a document name — a link, a backticked path or a bare
 * `x.md` — then `§`, then the section, which may start on the next line of a
 * wrapped comment. It holds when a heading or a bold lead-in of the document
 * is what the text after `§` begins with, or when the words up to its first
 * punctuation are the opening whole words of one (five characters at least).
 * After `§§` every item of a list is held the same way.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";
import { writeOut } from "./stdio.mjs";

const skipped = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".turbo", "coverage"]);
const scanned =
  /(?:\.(?:md|mdx|txt|ts|tsx|js|jsx|mjs|cjs|json|yml|yaml|toml|sh|sql|css|py|rb|go|rs|php|java|kt|swift)|^Dockerfile(?:\..+)?)$/u;

const within = (file, root) => root === "." || file === root || file.startsWith(`${root}/`);

/** What a heading and a reference have to agree on, and nothing more. */
const plain = (text) =>
  text
    .replace(/[`*_“”«»"]/gu, "")
    .replace(/’/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

/** The heading keys of a markdown text: each heading, its short forms, each bold lead-in. */
export function headingKeys(text) {
  const found = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/u.test(line)) fenced = !fenced;
    const heading = !fenced && /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1];
    if (!heading) continue;
    found.push(plain(heading));
    const number = /^(\d+)\.\s/u.exec(heading)?.[1];
    if (number) found.push(number);
    // `Name (a note)` and `Name — a gloss` are cited by the name alone.
    for (const bare of [heading.replace(/\s*\(.*$/u, ""), heading.replace(/^\d+\.\s+/u, "").split(/ — |: |, /u)[0]]) {
      if (plain(bare)) found.push(plain(bare));
    }
  }
  // A paragraph, a bullet or a checklist item that opens in bold names a section too.
  for (const [, name] of text.matchAll(/^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?(?:\[[ x]\][ \t]+)?\*\*([^*]+?)[.,:]?\*\*/gmu)) {
    found.push(plain(name));
  }
  return found;
}

/** `[x.md]`, `[x.md](./x.md)`, `[text](./x.md)`, `` `x.md` `` or `x.md`, a colon or not, `§`, the section. */
const reference =
  /(?:\[([^\]\n]*?\.md)\](?:\(([^)\n]*?\.md)(?:#[^)\n]*)?\))?|\[([^\]\n]+)\]\(([^)\n]*?\.md)(?:#[^)\n]*)?\)|`([\w./-]+\.md)`|(?<![\w./:-])([\w./-]+\.md))[*_`]*:?\s*(?:\n[ \t]*(?:\*|\/\/|#|>|--)?[ \t]*)?§(§?)\s*(?:\n[ \t]*(?:\*|\/\/|#|>|--)?[ \t]*)?/gu;

/** The section's words, a wrapped comment's lines folded into one. */
const sectionAt = (rest) =>
  plain(
    rest
      .replace(/\n[ \t]*(?:\/\*\*|\*|\/\/|#|>|--)?[ \t]*/gu, " ")
      .replace(/^§+\s*/u, "")
      .replace(/^(?:[#*>/]|--)+\s*/u, ""),
  );

/** The part of `section` that is the name, as far as its punctuation says. */
const named = (section) => section.split(/[)\];]|\. |\.$| — |: |, | \/ |\//u)[0].trim();

/** How much of `rest` a key names: a whole key, or whole opening words of one. */
function consumed(keys, rest) {
  let longest = 0;
  for (const key of keys) {
    if (rest.startsWith(key) && !/[a-z0-9]/u.test(rest.charAt(key.length))) longest = Math.max(longest, key.length);
  }
  if (longest > 0) return longest;
  const cut = named(rest);
  return cut.length >= 5 && keys.some((key) => key.startsWith(cut) && !/[a-z0-9]/u.test(key.charAt(cut.length)))
    ? cut.length
    : 0;
}

/** The first item of the reference that names nothing, or null. */
function unnamed(keys, section, list) {
  let rest = section;
  for (;;) {
    const length = consumed(keys, rest);
    if (length === 0) return rest;
    if (!list) return null;
    const next = /^(?:, and |, | and )/u.exec(rest.slice(length));
    if (next === null) return null;
    rest = rest.slice(length + next[0].length);
  }
}

/** Repository-relative files under `roots` that pass `keep`, history and generated directories left out. */
export function filesUnder(root, roots, history, keep = (name) => scanned.test(name)) {
  const found = [];
  const walk = (relative) => {
    if (history.some((h) => within(relative, h))) return;
    let info;
    try {
      info = statSync(path.join(root, relative));
    } catch {
      return;
    }
    if (!info.isDirectory()) {
      if (keep(path.basename(relative))) found.push(relative);
      return;
    }
    for (const name of readdirSync(path.join(root, relative))) {
      if (!skipped.has(name)) walk(relative === "." ? name : `${relative}/${name}`);
    }
  };
  roots.forEach((r) => walk(path.normalize(r)));
  return [...new Set(found)];
}

/** `<file>: <document> § <section>` for each reference under the scan roots that names no heading. */
export function checkSections({ root, docs }) {
  const { scanRoots, historyRoots } = docs;
  const files = filesUnder(root, scanRoots, historyRoots);
  const historyNames = new Set(filesUnder(root, historyRoots, [], (n) => n.endsWith(".md")).map((f) => path.basename(f)));
  const byName = new Map();
  for (const file of files.filter((f) => f.endsWith(".md"))) {
    byName.set(path.basename(file), [...(byName.get(path.basename(file)) ?? []), file]);
  }
  const isFile = (relative) => {
    try {
      return statSync(path.join(root, relative)).isFile();
    } catch {
      return false;
    }
  };
  /** The document a name means; `history` when it is one; null when the tree does not say. */
  const resolve = (name, from, target) => {
    const candidates = [
      ...(target ? [path.join(path.dirname(from), target)] : []),
      path.join(path.dirname(from), name),
      name,
    ].map((c) => path.normalize(c));
    for (const candidate of candidates) {
      if (isFile(candidate)) return historyRoots.some((h) => within(candidate, h)) ? "history" : candidate;
    }
    if (historyNames.has(path.basename(name))) return "history";
    const matches = byName.get(path.basename(name)) ?? [];
    return matches.length === 1 ? matches[0] : null;
  };

  const keysOf = new Map();
  const failures = [];
  for (const file of files) {
    const text = readFileSync(path.join(root, file), "utf8");
    for (const match of text.matchAll(reference)) {
      const name = match[1] ?? match[4] ?? match[5] ?? match[6] ?? "";
      const end = match.index + match[0].length;
      // The sign named in a sentence, with no section after it.
      if (!/^[\w(]/u.test(text.slice(end).trimStart().replace(/^(?:[*/#>\s]|--)+/u, ""))) continue;
      const document = resolve(name, file, match[2] ?? match[4]);
      if (document === "history") continue;
      const section = sectionAt(text.slice(end, end + 240));
      if (document === null) {
        failures.push(`${file}: ${name} § ${named(section)} — no such document`);
        continue;
      }
      if (!keysOf.has(document)) keysOf.set(document, headingKeys(readFileSync(path.join(root, document), "utf8")));
      const bad = unnamed(keysOf.get(document), section, match[7] === "§");
      if (bad !== null) failures.push(`${file}: ${document} § ${named(bad)}`);
    }
  }
  return failures;
}

/**
 * Runs a check as a command: `off` (a line, exit 0) when `off(config)` names
 * the empty key, else one line per failure and exit 1, or `ok` and exit 0.
 */
export function runCheck(check, { off, ok }) {
  let config;
  let failures;
  try {
    config = loadConfig();
    if (off(config)) {
      console.log(off(config));
      return;
    }
    failures = check(config);
  } catch (e) {
    writeOut(`${e.message}\n`);
    process.exit(1);
  }
  writeOut(failures.map((line) => `${line}\n`).join(""));
  if (failures.length) process.exit(1);
  console.log(ok);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCheck(checkSections, {
    off: (c) => c.docs.scanRoots.length === 0 && "sections: off, docs.scanRoots is empty",
    ok: "sections: every reference names a heading",
  });
}
