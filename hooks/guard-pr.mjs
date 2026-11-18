#!/usr/bin/env node
/**
 * PreToolUse on Bash: the first `gh pr create` of a branch in a session is
 * refused once with what its handover owes (`pr.checklist`), so the handover
 * does not depend on a skill being read. It applies when the diff touches
 * `pr.productPaths` or `surface.paths`; for the latter the delivery criterion
 * (`surface.criterion`) is named too. The same branch again in the same
 * session passes.
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
if (pr.productPaths.length === 0 && surface.paths.length === 0) process.exit(0);

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
if (!product && !drawn) process.exit(0);

const session = String(input.session_id ?? "none").replace(/[^\w-]/gu, "");
const seenFile = path.join(tmpdir(), `docrank-pr-handover-${session}`);
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
