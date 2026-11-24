#!/usr/bin/env node
/**
 * Runs the repository's gates (`gates.run`) in order from its root, stopping at
 * the first failure, and the named jobs (`gates.jobs`, or a group of them from
 * `gates.groups`) only when asked. `gates.prelude` is shell text run before
 * every command, in the same shell, and `gates.preflight` a command run once
 * before the first, whose failure ends the run with its output. Each
 * command's full output goes to its own log; stdout carries one PASS or FAIL
 * line per command and, for a failure, the tail of its log, so a forked context
 * reads what explains it and nothing else.
 *
 *   node run-gates.mjs                  every gate, in order
 *   node run-gates.mjs lint test        those gates, still in configured order
 *   node run-gates.mjs -C ../tree e2e   another tree; `e2e` is a key of gates.jobs or gates.groups
 *
 * When every gate passed on a clean tree whose HEAD did not move, HEAD is
 * appended to the record the Bash guard (and the optional pre-push hook) read.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigError, findRoot, loadConfig } from "../lib/config.mjs";

const TAIL_LINES = 40;
const out = (s = "") => process.stdout.write(`${s}\n`);
const die = (message, code = 1) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};
const git = (root, ...args) => {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

let args = process.argv.slice(2);
let dir = process.cwd();
if (args[0] === "-C") {
  if (args.length < 2) die("-C needs a directory", 2);
  dir = path.resolve(args[1]);
  // Falling through to another tree would report a verdict about the wrong one.
  if (!git(dir, "rev-parse", "--show-toplevel")) die(`"${args[1]}" is not inside a git work tree.`);
  args = args.slice(2);
}

let config;
try {
  config = loadConfig({ cwd: findRoot({ cwd: dir }) });
} catch (e) {
  if (!(e instanceof ConfigError)) throw e;
  die(e.message);
}
const { root, gates } = config;

const head = git(root, "rev-parse", "HEAD");
const isDirty = () => !!git(root, "status", "--porcelain");
const dirtyAtStart = isDirty();
out(`tree ${root} @ ${head?.slice(0, 7) ?? "unknown"}${dirtyAtStart ? " +dirty" : ""}`);

const gateNames = gates.run.map((g) => g.name);
const known = (n) => gateNames.includes(n) || Object.hasOwn(gates.jobs, n) || Object.hasOwn(gates.groups, n);
const unknown = args.filter((n) => !known(n));
if (unknown.length) {
  const groups = Object.keys(gates.groups);
  die(
    `Unknown name "${unknown[0]}". Gates: ${gateNames.join(", ") || "none"}; jobs: ${Object.keys(gates.jobs).join(", ") || "none"}${groups.length ? `; groups: ${groups.join(", ")}` : ""}`,
  );
}
// A group is its jobs, so each is named once however it was asked for.
const asked = new Set(args.flatMap((n) => (Object.hasOwn(gates.groups, n) ? gates.groups[n] : [n])));
if (!gateNames.length && !args.length) {
  out("gates.run is empty: nothing to run.");
  process.exit(0);
}

const selected = args.length ? gates.run.filter((g) => asked.has(g.name)) : gates.run;
const jobs = Object.keys(gates.jobs)
  .filter((name) => asked.has(name) && !gateNames.includes(name))
  .map((name) => ({ name, command: gates.jobs[name] }));

const logdir = mkdtempSync(path.join(tmpdir(), "docrank-gates-"));
out(`logs in ${logdir}\n`);

/**
 * Runs `command` through the shell from the root, after the prelude, which
 * shares its shell, so what it exports or sources reaches the command. A
 * failure ends the run, its log's tail printed.
 */
function execute({ name, command }, index) {
  const log = path.join(logdir, `${index}-${name.replace(/[^\w.-]/g, "_")}.log`);
  const fd = openSync(log, "w");
  const text = gates.prelude ? `{ ${gates.prelude}\n} && { ${command}\n}` : command;
  const { status } = spawnSync(text, { shell: true, cwd: root, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  if (status === 0) return out(`PASS ${name}`);
  out(`FAIL ${name}`);
  out(`log: ${log}\n${readFileSync(log, "utf8").split("\n").slice(-TAIL_LINES).join("\n")}`);
  out("\nStopped at the first failure; what comes after it did not run.");
  process.exit(1);
}

if (gates.preflight) execute({ name: "preflight", command: gates.preflight }, "pre");
selected.forEach(execute);

// Only a clean tree is recorded, and only if HEAD did not move while the
// gates ran: a dirty tree's pass says nothing about any commit.
const everyGate = selected.length === gateNames.length && selected.length > 0;
if (everyGate && head && !dirtyAtStart && !isDirty() && git(root, "rev-parse", "HEAD") === head) {
  const common = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  appendFileSync(path.join(common, gates.record), `${head}\n`);
  out(`recorded ${head.slice(0, 9)} for the push`);
}

jobs.forEach((job, i) => execute(job, selected.length + i));
out("\nAll passed.");
