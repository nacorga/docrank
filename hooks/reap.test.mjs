/**
 * The reaper on real processes: each test starts stub servers of its own
 * (`node -e` waiting forever) in a sandbox repository, runs the hook there,
 * and reads which stubs are still alive. A stub is found by the sandbox's
 * directory, so the hook can reach only what the test started; whatever is
 * left is stopped by the test afterwards.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { project, runExit } from "../lib/testing.mjs";

const STUB = "setInterval(() => {}, 1000)";
const started = [];

afterEach(() => {
  for (const pgid of started.splice(0)) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
});

/** A pid that no longer runs: a session that is gone. */
function deadPid() {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

/** A sandbox repository whose config turns the reaper on. */
function sandbox(reap = { enabled: true }) {
  const dir = project({ ".claude/docrank.json": JSON.stringify({ reap }) });
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
  return dir;
}

const env = (session) => ({ ...process.env, CLAUDE_PID: String(session) });

/**
 * A stub in a group whose leader is gone: a shell, the group's leader, starts
 * the stub in the background and exits, as a killed runner leaves a server.
 * Resolves to the stub's pid and group.
 */
function orphanStub(cwd, session, tag = "stub") {
  return new Promise((resolve, reject) => {
    const shell = spawn("sh", ["-c", `"${process.execPath}" -e '${STUB}' ${tag} >/dev/null 2>&1 & echo $!`], {
      cwd,
      detached: true,
      env: env(session),
      stdio: ["ignore", "pipe", "ignore"],
    });
    started.push(shell.pid);
    let text = "";
    shell.stdout.on("data", (d) => (text += d));
    shell.on("error", reject);
    shell.on("close", () => resolve({ pid: Number(text.trim()), pgid: shell.pid }));
  });
}

/** A stub leading its own group, held by this test as its parent. */
function heldStub(cwd, session) {
  const child = spawn(process.execPath, ["-e", STUB], { cwd, detached: true, env: env(session), stdio: "ignore" });
  started.push(child.pid);
  return { pid: child.pid, pgid: child.pid };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Waits up to `ms` for `pid` to be gone; whether it went. */
async function gone(pid, ms = 10000) {
  for (const until = Date.now() + ms; Date.now() < until; ) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const start = (dir, session = deadPid()) => runExit("reap.mjs", { hook_event_name: "SessionStart", source: "startup" }, dir, { CLAUDE_PID: String(session) });
const finish = (dir, session, reason = "prompt_input_exit") =>
  runExit("reap.mjs", { hook_event_name: "SessionEnd", reason }, dir, { CLAUDE_PID: String(session) });

describe("reap.mjs at session start", { timeout: 30000 }, () => {
  it("stops a group in a checkout whose leader and session are gone, and says so", async () => {
    const dir = sandbox();
    const stub = await orphanStub(dir, deadPid());
    const { status, stdout } = await start(dir);
    expect(status).toBe(0);
    expect(await gone(stub.pid)).toBe(true);
    expect(stdout).toMatch(/^docrank reap: stopped 1 process group\(s\) nobody held, in /u);
  });

  it("stops one in a worktree beside the main checkout that was removed and pruned under it", async () => {
    const dir = sandbox();
    const tree = `${dir}-removed`;
    execFileSync("git", ["-C", dir, "worktree", "add", "-q", tree]);
    const stub = await orphanStub(tree, deadPid());
    rmSync(tree, { recursive: true, force: true });
    execFileSync("git", ["-C", dir, "worktree", "prune"]);
    await start(dir);
    expect(await gone(stub.pid)).toBe(true);
  });

  it("leaves a group whose session is alive, one held by a live parent, and one started outside a session", async () => {
    const dir = sandbox();
    const live = await orphanStub(dir, process.pid);
    const held = heldStub(dir, deadPid());
    const outside = await orphanStub(dir, 0);
    const { stdout } = await start(dir);
    expect(stdout).toBe("");
    expect([alive(live.pid), alive(held.pid), alive(outside.pid)]).toEqual([true, true, true]);
  });

  it("leaves a group outside the repository's checkouts", async () => {
    const dir = sandbox();
    const elsewhere = project();
    const stub = await orphanStub(elsewhere, deadPid());
    await start(dir);
    expect(alive(stub.pid)).toBe(true);
  });

  it("leaves a group whose command line matches reap.keep", async () => {
    const dir = sandbox({ enabled: true, keep: ["kept-server"] });
    const stub = await orphanStub(dir, deadPid(), "kept-server");
    await start(dir);
    expect(alive(stub.pid)).toBe(true);
  });

  it("reads CLAUDE_PID from the environment only, never from an argument", async () => {
    const dir = sandbox();
    const stub = await orphanStub(dir, 0, `CLAUDE_PID=${deadPid()}`);
    expect((await start(dir)).stdout).toBe("");
    expect(alive(stub.pid)).toBe(true);
  });

  it("stops nothing when a read does not answer in time", async () => {
    const dir = sandbox();
    const stub = await orphanStub(dir, deadPid());
    const bin = project({ ps: "#!/bin/sh\nexec sleep 30\n" });
    chmodSync(path.join(bin, "ps"), 0o755);
    const { status, stdout, stderr } = await runExit("reap.mjs", { hook_event_name: "SessionStart", source: "startup" }, dir, {
      PATH: `${bin}:${process.env.PATH}`,
    });
    expect([status, stdout]).toEqual([0, ""]);
    expect(stderr).toBe("docrank reap: `ps` did not answer in time; nothing stopped\n");
    expect(alive(stub.pid)).toBe(true);
  });

  it("stops nothing while off, and on an invalid config", async () => {
    for (const reap of [{ enabled: false }, { enabled: "yes" }]) {
      const dir = sandbox(reap);
      const stub = await orphanStub(dir, deadPid());
      const { status } = await start(dir);
      expect(status).toBe(0);
      expect(alive(stub.pid)).toBe(true);
    }
  });
});

describe("reap.mjs at session end", { timeout: 30000 }, () => {
  it("returns at once and stops the ending session's groups, held or not, and no other", async () => {
    const dir = sandbox();
    const session = deadPid();
    const held = heldStub(dir, session);
    const orphaned = await orphanStub(dir, session);
    const other = await orphanStub(dir, process.pid);
    const begun = Date.now();
    expect((await finish(dir, session)).status).toBe(0);
    expect(Date.now() - begun).toBeLessThan(1500);
    expect(await gone(held.pid)).toBe(true);
    expect(await gone(orphaned.pid)).toBe(true);
    expect(alive(other.pid)).toBe(true);
  });

  it("stops nothing on clear or resume, when the session's process lives on", async () => {
    const dir = sandbox();
    const session = deadPid();
    const held = heldStub(dir, session);
    for (const reason of ["clear", "resume"]) {
      const { status, stderr } = await finish(dir, session, reason);
      expect(status).toBe(0);
      expect(stderr).toBe(`docrank reap: the session goes on (${reason}); nothing stopped.\n`);
      expect(alive(held.pid)).toBe(true);
    }
    // The same session ending for good stops the same stub: the runs above decided, not missed it.
    expect((await finish(dir, session, "other")).stderr).toBe("docrank reap: stopping this session's groups in the background.\n");
    expect(await gone(held.pid)).toBe(true);
  });
});

