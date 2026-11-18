#!/usr/bin/env node
/**
 * Follows a pull request so the session hears about it before the user does.
 * Run it in the background the moment the pull request opens: it exits at the
 * first thing the session must act on, and the exit is what wakes the session.
 *
 *   watch-pr.mjs <n>          GREEN when every check passed, NO CI when its base
 *                             is not one of `pr.ciBases`, or RED and the failed
 *                             or cancelled checks at the first failure
 *   watch-pr.mjs <n> merged   MERGED and the merge commit, CLOSED, CONFLICTING
 *                             when another merge left it so, or ORPHANED when
 *                             its branch moved past the merge
 *
 * Two holes of a bare `gh pr checks --watch` are closed here: before the first
 * run registers it exits at once with "no checks reported", and without
 * --fail-fast it waits for the slowest job before reporting a failure GitHub
 * already shows. GitHub answers UNKNOWN while it recomputes a pull request's
 * mergeability, so only CONFLICTING itself counts. Exit 0 on GREEN, NO CI and
 * MERGED, 1 otherwise.
 */
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { ConfigError, loadConfig } from "../lib/config.mjs";
import { glob, run } from "../lib/git.mjs";

const [n, mode] = process.argv.slice(2);
if (!/^\d+$/.test(n ?? "") || (mode && mode !== "merged")) {
  process.stderr.write("usage: watch-pr.mjs <number> [merged]\n");
  process.exit(2);
}

let config;
try {
  config = loadConfig();
} catch (e) {
  if (!(e instanceof ConfigError)) throw e;
  process.stderr.write(`${e.message}\n`);
  process.exit(2);
}

const poll = Number(process.env.DOCRANK_POLL_MS) || 15000;
const registerLimit = Number(process.env.DOCRANK_REGISTER_MS) || 900000; // 15 minutes
const gh = (...args) => run("gh", args, config.root);
const done = (line, code) => {
  console.log(line);
  process.exit(code);
};

if (mode === "merged") {
  for (;;) {
    const view = JSON.parse(gh("pr", "view", n, "--json", "state,mergeable,headRefName,headRefOid,mergeCommit") || "{}");
    if (view.state === "MERGED") {
      // A commit pushed after the merge reaches nothing and shows in no listing:
      // the branch's tip on GitHub must be the merged head.
      const tip = run("git", ["ls-remote", "origin", `refs/heads/${view.headRefName}`], config.root)?.split(/\s/)[0];
      if (tip && tip !== view.headRefOid) done(`ORPHANED origin/${view.headRefName} is at ${tip}, past the merged head ${view.headRefOid}`, 1);
      done(`MERGED ${view.mergeCommit?.oid ?? ""}`.trim(), 0);
    }
    if (view.state === "CLOSED") done("CLOSED", 1);
    if (view.state === "OPEN" && view.mergeable === "CONFLICTING") done("CONFLICTING", 1);
    await sleep(2 * poll);
  }
}

const base = gh("pr", "view", n, "--json", "baseRefName", "-q", ".baseRefName");
if (!base) done(`could not read the base of pull request ${n}`, 1);
if (!config.pr.ciBases.map(glob).some((g) => g.test(base))) done(`NO CI on a pull request into ${base}`, 0);

// gh exits non-zero on "no checks reported" and on failed checks: read what it
// says, not its status.
const ghRaw = (...args) => spawnSync("gh", args, { cwd: config.root, encoding: "utf8" });
const registered = () => {
  const r = ghRaw("pr", "checks", n);
  return !/no checks reported/.test(r.stderr + r.stdout);
};
for (let waited = 0; !registered(); waited += poll) {
  if (waited >= registerLimit) done("RED no check registered in time", 1);
  await sleep(poll);
}

const watched = ghRaw("pr", "checks", n, "--watch", "--fail-fast", "--interval", String(Math.max(1, Math.round(poll / 1000))));
if (watched.status === 0) done("GREEN", 0);
console.log("RED");
const failed = JSON.parse(ghRaw("pr", "checks", n, "--json", "name,bucket,link").stdout || "[]");
for (const c of failed.filter((c) => c.bucket === "fail" || c.bucket === "cancel")) console.log(`${c.name}\t${c.bucket}\t${c.link}`);
process.exit(1);
