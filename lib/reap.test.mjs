import { describe, expect, it } from "vitest";
import { orphanGroups } from "./reap.mjs";

const MAIN = "/w/app";
const checkouts = [MAIN, "/w/app-feature"];
const SELF = 9000;

/**
 * A process table and what can be read of it. Each process is
 * `[pid, {ppid, pgid, command, dir, session}]`; `session` is its
 * `CLAUDE_PID` (0 for none, undefined for unreadable). `live` lists the
 * sessions still alive; `existing` the directories still on disk.
 */
function reads(processes, { live = [], existing = [] } = {}) {
  const all = new Map([[SELF, { ppid: 1, pgid: SELF, command: "node reap.mjs", dir: MAIN, session: 7 }], ...processes]);
  return {
    table: () => new Map([...all].map(([pid, p]) => [pid, { ppid: p.ppid, pgid: p.pgid, command: p.command }])),
    directories: () => new Map([...all].filter(([, p]) => p.dir).map(([pid, p]) => [pid, p.dir])),
    sessions: (pids) => new Map(pids.filter((pid) => all.get(pid).session !== undefined).map((pid) => [pid, all.get(pid).session])),
    alive: (pid) => live.includes(pid),
    exists: (dir) => checkouts.includes(dir) || existing.includes(dir),
  };
}

const sweep = (processes, options, keep) => orphanGroups({ checkouts, keep, self: SELF }, reads(processes, options)).map((g) => g.pgid);
const end = (session, processes, options, keep) =>
  orphanGroups({ checkouts, session, keep, self: SELF }, reads(processes, options)).map((g) => g.pgid);

/** A group of one process, its own leader, adopted by PID 1. */
const orphan = (pid, fields = {}) => [pid, { ppid: 1, pgid: pid, command: "node server.js", dir: `${MAIN}/web`, session: 42, ...fields }];

describe("orphanGroups, at session start", () => {
  it("stops an adopted group in a checkout whose session is gone", () => {
    expect(sweep([orphan(100)])).toEqual([100]);
  });

  it("stops a group whose leader is gone, through the member left in it", () => {
    expect(sweep([[101, { ppid: 1, pgid: 100, command: "node server.js", dir: `${MAIN}/web`, session: 42 }]])).toEqual([100]);
  });

  it("stops a group in another worktree, and in a removed one beside the main checkout", () => {
    expect(sweep([orphan(100, { dir: "/w/app-feature" }), orphan(200, { dir: "/w/app-gone/web" })])).toEqual([100, 200]);
  });

  it("leaves a directory outside the checkouts, and a sibling that still exists but is not one", () => {
    expect(sweep([orphan(100, { dir: "/w/other" }), orphan(200, { dir: "/w/app-other/x" })], { existing: ["/w/app-other"] })).toEqual([]);
  });

  it("leaves a group whose session is alive", () => {
    expect(sweep([orphan(100)], { live: [42] })).toEqual([]);
  });

  it("leaves a group whose leader a live process holds", () => {
    expect(sweep([[100, { ppid: 555, pgid: 100, command: "node server.js", dir: `${MAIN}/web`, session: 42 }]])).toEqual([]);
  });

  it("leaves a process started outside Claude Code, and one whose environment cannot be read", () => {
    expect(sweep([orphan(100, { session: 0 }), orphan(200, { session: undefined })])).toEqual([]);
  });

  it("leaves a group with any member it cannot prove left behind", () => {
    const group = [orphan(100), [101, { ppid: 100, pgid: 100, command: "sh", dir: MAIN, session: 0 }]];
    expect(sweep(group)).toEqual([]);
  });

  it("leaves a group a member of which matches reap.keep, and docrank's watch server", () => {
    const group = [orphan(100), [101, { ppid: 100, pgid: 100, command: "npm run dev", dir: "/elsewhere", session: 42 }]];
    expect(sweep(group, {}, ["\\bnpm run dev\\b"])).toEqual([]);
    expect(sweep([orphan(200, { command: "node /plugin/scripts/watch-server.mjs --port 1" })])).toEqual([]);
  });

  it("leaves the group of this process and of its ancestors", () => {
    const parent = [8000, { ppid: 1, pgid: 8000, command: "claude", dir: MAIN, session: 42 }];
    const self = [SELF, { ppid: 8000, pgid: 8000, command: "node reap.mjs", dir: MAIN, session: 42 }];
    expect(sweep([parent, self])).toEqual([]);
  });
});

describe("orphanGroups, at session end", () => {
  it("stops the ending session's groups, held or not", () => {
    const held = [100, { ppid: 555, pgid: 100, command: "node server.js", dir: `${MAIN}/web`, session: 42 }];
    expect(end(42, [held, orphan(200)], { live: [42] })).toEqual([100, 200]);
  });

  it("leaves another session's group, one started outside, and reap.keep", () => {
    expect(end(42, [orphan(100, { session: 43 }), orphan(200, { session: 0 })])).toEqual([]);
    expect(end(42, [orphan(100)], {}, ["server\\.js"])).toEqual([]);
  });

  it("leaves the ending session's own process group and its ancestors'", () => {
    const claude = [42, { ppid: 41, pgid: 42, command: "claude", dir: MAIN, session: 0 }];
    const shell = [43, { ppid: 42, pgid: 42, command: "bash", dir: MAIN, session: 42 }];
    expect(end(42, [claude, shell])).toEqual([]);
  });
});
