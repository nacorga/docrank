#!/usr/bin/env node
/**
 * SessionStart, off unless `plans.atStart`: lists each plan in this
 * checkout's `ship.plansDir` with its checked items over all of them, and
 * whether it has a hand-off section, so a session knows which plan to pick
 * up and where to read where it stopped. A `README.md` there describes the
 * directory and is no plan; a box or a heading inside a fenced code block is
 * an example, not an item.
 *
 * It runs on every `source` (a plugin's SessionStart has no matcher: harness
 * fact 14; the sources are fact 28), and `compact` is where it matters most: a summarized context has
 * lost what the plan holds. Read-only; a directory that does not exist, a
 * config that does not validate or a file that cannot be read lists nothing
 * and never fails the session.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../lib/config.mjs";

/** The text with each fenced code block (``` or ~~~) blanked out. */
function outsideFences(text) {
  let fence = null;
  return text
    .split("\n")
    .map((line) => {
      const open = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
      if (fence === null && open) {
        fence = open[1];
        return "";
      }
      if (fence !== null) {
        if (new RegExp(`^\\s{0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`, "u").test(line)) fence = null;
        return "";
      }
      return line;
    })
    .join("\n");
}

/** `{checked, total, handoff}` of a plan's text. */
function progressOf(raw) {
  const text = outsideFences(raw);
  const boxes = [...text.matchAll(/^\s*[-*+] \[([ xX])\] /gmu)];
  return {
    checked: boxes.filter((b) => b[1] !== " ").length,
    total: boxes.length,
    handoff: /^#{1,6}[ \t]+Hand-?off\b/imu.test(text),
  };
}

try {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const { root, plans, ship } = loadConfig({ cwd: input.cwd || process.cwd() });
  if (plans.atStart) {
    const dir = path.join(root, ship.plansDir);
    let names = [];
    try {
      names = readdirSync(dir)
        .filter((n) => n.endsWith(".md") && n.toLowerCase() !== "readme.md")
        .sort();
    } catch {
      // No plans directory: nothing in progress.
    }
    const lines = names.flatMap((name) => {
      try {
        const { checked, total, handoff } = progressOf(readFileSync(path.join(dir, name), "utf8"));
        const where = path.posix.join(ship.plansDir.split(path.sep).join("/"), name);
        return [`- \`${where}\` · ${total ? `${checked}/${total}` : "no checklist"}${handoff ? " · § Handoff" : ""}`];
      } catch {
        return [];
      }
    });
    if (lines.length > 0) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ["Plans in progress:", ...lines].join("\n") },
        }),
      );
    }
  }
} catch {
  // Silent: a hook that informs never fails a session.
}
