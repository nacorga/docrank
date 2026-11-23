/**
 * The watch history on disk: which session logs the server keeps. A log is
 * one session's file under `<watch home>/<repo key>/`; its age is its mtime,
 * the time of its last line.
 *
 * Retention runs on the server, the one process that outlives sessions. It
 * deletes by age alone: a session still writing has a fresh mtime, and the
 * shortest retention, one day, is longer than the idle timeout after which a
 * quiet session counts as done, so a live session's file is never old enough.
 * The idle check below states that rather than relying on it.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { IDLE_MS } from "./reduce.mjs";

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes the session logs under `home` last written more than `days` ago,
 * and returns them. A repository's directory stays, even empty: a hook may be
 * about to write in it.
 */
export function prune(home, days, { now = Date.now(), idleMs = IDLE_MS } = {}) {
  const cutoff = now - days * DAY_MS;
  const gone = [];
  let repos = [];
  try {
    repos = readdirSync(home, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return gone;
  }
  for (const r of repos) {
    const dir = path.join(home, r.name);
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = path.join(dir, f);
      try {
        const { mtimeMs } = statSync(file);
        if (mtimeMs >= cutoff || now - mtimeMs < idleMs) continue;
        rmSync(file);
        gone.push(file);
      } catch {}
    }
  }
  return gone;
}
