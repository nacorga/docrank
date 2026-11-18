#!/usr/bin/env node
/**
 * The `docrank` command: `docrank <name> [args]` runs `lib/cli/<name>.mjs`.
 * A subcommand is one file there whose default export takes the arguments and
 * returns the text to print; throwing prints the message and exits 1. A
 * subcommand with subcommands of its own (`check sections`) dispatches them
 * itself.
 */
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../lib/cli/", import.meta.url));
const [name, ...args] = process.argv.slice(2);
const commands = readdirSync(dir).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs")).map((f) => f.slice(0, -4));

if (!name || !/^[a-z][a-z-]*$/.test(name) || !existsSync(`${dir}${name}.mjs`)) {
  process.stderr.write(`Usage: docrank <${commands.join("|")}> [args]\n`);
  process.exit(2);
}
try {
  const out = await (await import(`${dir}${name}.mjs`)).default(args);
  if (out) console.log(out);
} catch (e) {
  process.stderr.write(`docrank ${name}: ${e.message}\n`);
  process.exit(1);
}
