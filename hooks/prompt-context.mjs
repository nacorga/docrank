#!/usr/bin/env node
/**
 * UserPromptSubmit, off unless `prompts.context`: a prompt that matches an
 * entry gets that entry's file as context, so a protocol the repository keeps
 * in a file reaches the session without anyone typing it.
 *
 * It informs and never blocks: an input it cannot parse, a config that does
 * not validate, a file that cannot be read, each adds nothing and exits 0.
 * The text is the file's, read at each prompt, so the repository keeps one
 * copy and the hook carries none.
 *
 * Shapes: harness fact 27 (`prompt` in, `additionalContext` out).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../lib/config.mjs";

try {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (typeof input.prompt !== "string") process.exit(0);
  const { root, prompts } = loadConfig({ cwd: input.cwd || process.cwd() });

  const files = [];
  for (const { match, file } of prompts.context) {
    if (!new RegExp(match, "iu").test(input.prompt) || files.includes(file)) continue;
    files.push(file);
  }
  const texts = files.flatMap((file) => {
    try {
      const text = readFileSync(path.resolve(root, file), "utf8").trim();
      return text ? [text] : [];
    } catch {
      return [];
    }
  });
  if (texts.length > 0) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: texts.join("\n\n") } }),
    );
  }
} catch {
  // Silent: a hook that informs never fails a prompt.
}
