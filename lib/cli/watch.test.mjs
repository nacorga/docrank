import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { project } from "../testing.mjs";
import { version } from "../watch/launch.mjs";

const BIN = path.join(import.meta.dirname, "..", "..", "bin", "docrank.mjs");
const pids = [];
afterEach(() => pids.splice(0).forEach((pid) => {
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}));

async function freePort() {
  const s = createServer().listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

const run = (dir, home, ...args) =>
  spawnSync(process.execPath, [BIN, "watch", ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, HOME: home, DOCRANK_WATCH_NO_OPEN: "1", CLAUDE_PROJECT_DIR: dir } });

describe("docrank watch", () => {
  it("starts the server, prints the page's address and says when watch is off", async () => {
    const port = await freePort();
    const dir = project({ ".claude/docrank.json": JSON.stringify({ watch: { port, language: "es" } }) });
    const home = project();
    const r = run(dir, home);
    expect(r.status, r.stderr).toBe(0);
    const state = JSON.parse(readFileSync(path.join(home, ".claude", "docrank", "watch", "server.json"), "utf8"));
    pids.push(state.pid);
    expect(r.stdout).toBe(`http://127.0.0.1:${port}/?token=${state.token}&lang=es\nwatch.enabled is off in this repository: its sessions are not recorded.\n`);
    expect((await version(state))?.pid).toBe(state.pid);
    expect(run(dir, home, "--no-open").stdout.split("\n")[0]).toBe(r.stdout.split("\n")[0]);
  });

  it("refuses an unknown argument", () => {
    const r = run(project(), project(), "--nope");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage: docrank watch [--no-open]");
  });
});
