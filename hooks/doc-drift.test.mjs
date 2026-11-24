import { execFileSync } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { project, runExit } from "../lib/testing.mjs";

const config = { docDrift: { entries: [{ code: ["src/rates/"], docs: ["docs/rates.md"] }] } };
const sessions = [];
let counter = 0;

afterEach(() => {
  for (const session of sessions.splice(0)) rmSync(path.join(tmpdir(), `stickler-drift-${session}`), { force: true });
});

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", cwd, ...args], { stdio: "ignore" });
/** A repository whose `origin/main` is its first commit. */
function repo(extra = config, base = true) {
  const dir = project({ ".claude/stickler.json": JSON.stringify(extra) });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "base");
  if (base) git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  return dir;
}
const write = (dir, file) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), "");
};
const session = () => {
  const id = `probe-${process.pid}-${counter++}`;
  sessions.push(id);
  return id;
};
const stop = (dir, id, extra = {}) => runExit("doc-drift.mjs", { session_id: id, ...extra }, dir);

describe("doc-drift.mjs", () => {
  it("asks once when mapped code changed and its document did not", async () => {
    const dir = repo();
    const id = session();
    expect((await stop(dir, id)).status).toBe(0);
    write(dir, "src/rates/rate.js");
    const asked = await stop(dir, id);
    expect(asked.status).toBe(2);
    expect(asked.stderr).toContain("- src/rates/ changed; docs/rates.md did not");
    expect((await stop(dir, id)).status).toBe(0);
  });

  it("asks nothing once the document changed too", async () => {
    const dir = repo();
    write(dir, "src/rates/rate.js");
    write(dir, "docs/rates.md");
    expect((await stop(dir, session())).status).toBe(0);
  });

  it("reads committed work since the merge-base, not only the working tree", async () => {
    const dir = repo();
    write(dir, "src/rates/rate.js");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "work");
    expect((await stop(dir, session())).status).toBe(2);
  });

  it("leaves code no entry names alone", async () => {
    const dir = repo();
    write(dir, "src/other.js");
    expect((await stop(dir, session())).status).toBe(0);
  });

  it("does not ask again inside a stop hook it already caused", async () => {
    const dir = repo();
    write(dir, "src/rates/rate.js");
    expect((await stop(dir, session(), { stop_hook_active: true })).status).toBe(0);
  });

  it("compares against docDrift.baseRef", async () => {
    const dir = repo({ docDrift: { ...config.docDrift, baseRef: "origin/trunk" } }, false);
    git(dir, "update-ref", "refs/remotes/origin/trunk", "HEAD");
    write(dir, "src/rates/rate.js");
    expect((await stop(dir, session())).status).toBe(2);
  });

  it("is silent when the base ref does not exist, or the directory is no repository", async () => {
    const dir = repo(config, false);
    write(dir, "src/rates/rate.js");
    expect((await stop(dir, session())).status).toBe(0);
    expect((await stop(project({ ".claude/stickler.json": JSON.stringify(config) }), session())).status).toBe(0);
  });

  it("is off when docDrift.entries is empty", async () => {
    const dir = repo({});
    write(dir, "src/rates/rate.js");
    expect((await stop(dir, session())).status).toBe(0);
  });
});
