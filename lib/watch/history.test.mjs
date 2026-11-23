import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { project } from "../testing.mjs";
import { DAY_MS, prune, readLog, stateAt, summarize } from "./history.mjs";

const TRIAL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", "watch-trial-0.3.0.jsonl");

const NOW = Date.UTC(2026, 10, 23, 12);

/** A session log last written `daysAgo` days before NOW. */
function log(home, repo, session, daysAgo) {
  const dir = path.join(home, repo);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${session}.jsonl`);
  writeFileSync(file, "{}\n");
  const t = (NOW - daysAgo * DAY_MS) / 1000;
  utimesSync(file, t, t);
  return file;
}

describe("prune", () => {
  it("deletes the logs last written more than the retention ago, in every repository", () => {
    const home = project();
    const old = log(home, "shop-1234abcd", "old", 31);
    const edge = log(home, "shop-1234abcd", "edge", 29.9);
    const fresh = log(home, "blog-0000ffff", "fresh", 1);
    const older = log(home, "blog-0000ffff", "older", 400);
    expect(prune(home, 30, { now: NOW }).sort()).toEqual([older, old].sort());
    expect([old, edge, fresh, older].map(existsSync)).toEqual([false, true, true, false]);
    // The directory stays, even empty: a hook may be about to write in it.
    expect(existsSync(path.join(home, "shop-1234abcd"))).toBe(true);
  });

  it("keeps a session that wrote within the idle timeout, whatever the retention", () => {
    const home = project();
    const live = log(home, "shop-1234abcd", "live", 0.01);
    expect(prune(home, 0.001, { now: NOW, idleMs: DAY_MS })).toEqual([]);
    expect(existsSync(live)).toBe(true);
  });

  it("leaves other files alone, and a missing home is no error", () => {
    const home = project({ "server.json": "{}", "shop-1234abcd/notes.txt": "x" });
    for (const f of ["server.json", "shop-1234abcd/notes.txt"]) utimesSync(path.join(home, f), 0, 0);
    expect(prune(home, 1, { now: NOW })).toEqual([]);
    expect(prune(path.join(home, "missing"), 1, { now: NOW })).toEqual([]);
  });
});

describe("summarize", () => {
  it("gives the sessions list a log's start, state and task count", () => {
    const lines = readLog(TRIAL);
    expect(summarize(TRIAL)).toEqual({ startedAt: lines[0].time, lastAt: lines.at(-1).time, state: "done", tasks: 3 });
  });

  it("reads a log still being written, its last line cut short", () => {
    const head = readFileSync(TRIAL, "utf8").split("\n").slice(0, 7).join("\n");
    const file = path.join(project({ "s.jsonl": `${head}\n{"time":1795443793006,"ev` }), "s.jsonl");
    expect(readLog(file)).toHaveLength(7);
    expect(summarize(file)).toMatchObject({ state: "working", tasks: 1 });
  });

  it("counts neither dropped tasks nor an empty list", () => {
    const file = path.join(project({ "s.jsonl": "" }), "s.jsonl");
    expect(summarize(file)).toEqual({ startedAt: null, lastAt: null, state: "answer", tasks: 0 });
    const todos = (list) => JSON.stringify({ time: 1, event: "PreToolUse", toolUseId: `t${list.length}`, tool: "TodoWrite", input: { todos: list } });
    writeFileSync(file, `${todos([{ content: "a", status: "pending" }, { content: "b", status: "pending" }])}\n${todos([{ content: "a", status: "pending" }])}\n`);
    expect(summarize(file).tasks).toBe(1);
  });
});

describe("stateAt", () => {
  it("turns a session quiet for the idle timeout into done", () => {
    const sum = { lastAt: 1000, state: "working" };
    expect(stateAt(sum, 1500, 1000)).toBe("working");
    expect(stateAt(sum, 2001, 1000)).toBe("done");
  });
});
