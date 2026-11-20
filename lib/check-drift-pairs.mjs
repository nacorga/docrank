#!/usr/bin/env node
/**
 * Code with no drift pair asks nothing when it changes, which is how a
 * module grows for months while the document that states it ages. A unit is
 * each directory and each source file directly under a root of
 * `docs.unitRoots` (a `*` segment stands for every directory there); it is
 * paired when a `docDrift.entries` code prefix covers it, so a file a paired
 * directory gains needs nothing new. Code that states nothing a document
 * owns is named in `docDrift.unpaired` with the reason. Also refused: an
 * entry naming a path the tree no longer holds, and an exception that
 * excuses nothing.
 *
 * A unit is named without a trailing slash and a prefix is often written
 * with one, so a prefix covers a unit when it starts the unit's path plus
 * `/`: `src/payments/` and `src/pay` cover `src/payments`, while
 * `src/payments/stripe/` does not, since it names only part of the unit.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCheck } from "./check-sections.mjs";

const skipped = new Set(["node_modules", "dist", "build", "out", ".next", ".turbo", "coverage"]);
const notSource = /^\.|\.(?:test|spec)\.\w+$|\.d\.ts$/u;

/** The roots a pattern names: each `*` segment expanded to the directories there. */
function expand(root, pattern) {
  let found = [""];
  for (const segment of path.normalize(pattern).split("/")) {
    found = found.flatMap((dir) => {
      if (segment !== "*") return [dir ? `${dir}/${segment}` : segment];
      try {
        return readdirSync(path.join(root, dir), { withFileTypes: true })
          .filter((d) => d.isDirectory() && !skipped.has(d.name) && !d.name.startsWith("."))
          .map((d) => (dir ? `${dir}/${d.name}` : d.name));
      } catch {
        return [];
      }
    });
  }
  return found.filter((dir) => existsSync(path.join(root, dir)));
}

export function codeUnits(root, unitRoots) {
  return unitRoots
    .flatMap((pattern) => expand(root, pattern))
    .flatMap((dir) =>
      readdirSync(path.join(root, dir), { withFileTypes: true })
        .filter((d) => (d.isDirectory() ? !skipped.has(d.name) && !d.name.startsWith(".") : !notSource.test(d.name)))
        .map((d) => `${dir}/${d.name}`),
    )
    .sort();
}

/** Whether a path prefix of `docDrift` covers a unit, which carries no trailing slash. */
const covers = (prefix, unit) => `${unit}/`.startsWith(prefix);

/** One line per unit without a pair, per entry path not in the tree, per exception that excuses nothing. */
export function checkDriftPairs({ root, docs, docDrift }) {
  const codes = docDrift.entries.flatMap((entry) => entry.code);
  const paired = (unit) => codes.some((code) => covers(code, unit));
  const excused = Object.keys(docDrift.unpaired);
  const units = codeUnits(root, docs.unitRoots);
  return [
    ...docDrift.entries
      .flatMap((entry) => [...entry.code, ...entry.docs])
      .filter((p) => !existsSync(path.join(root, p)))
      .map((p) => `${p}: named in docDrift.entries, not in the tree`),
    ...units
      .filter((unit) => !paired(unit) && !excused.some((key) => covers(key, unit)))
      .map((unit) => `${unit}: no docDrift.entries pair and no docDrift.unpaired reason`),
    ...excused
      .filter((key) => !units.some((unit) => covers(key, unit) && !paired(unit)))
      .map((key) => `${key}: docDrift.unpaired excuses no unpaired unit; drop it`),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runCheck(checkDriftPairs, {
    off: (c) => c.docs.unitRoots.length === 0 && "drift-pairs: off, docs.unitRoots is empty",
    ok: "drift-pairs: every unit has a pair or a reason",
  });
}
