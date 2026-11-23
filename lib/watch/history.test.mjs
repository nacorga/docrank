import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { project } from "../testing.mjs";
import { DAY_MS, prune } from "./history.mjs";

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
