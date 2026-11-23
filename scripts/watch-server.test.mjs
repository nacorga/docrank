import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { get, request } from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROTOCOL, SERVER, ensureServer, pageUrl, version } from "../lib/watch/launch.mjs";
import { project, runExit } from "../lib/testing.mjs";

let home;
let pids = [];
const watch = () => path.join(home, ".claude", "docrank", "watch");
const state = () => JSON.parse(readFileSync(path.join(watch(), "server.json"), "utf8"));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Waits for `check` to hold, up to `ms`. */
async function until(check, ms = 5000) {
  for (let t = 0; t < ms; t += 25) {
    if (await check()) return true;
    await sleep(25);
  }
  return false;
}

/** Starts a server on a free port in the sandbox HOME; resolves to its server.json. */
async function start(env = {}) {
  const child = spawn(process.execPath, [SERVER, "--port", "0"], { stdio: "ignore", env: { ...process.env, HOME: home, ...env } });
  pids.push(child.pid);
  expect(await until(() => existsSync(path.join(watch(), "server.json")) && state().pid === child.pid)).toBe(true);
  return { ...state(), child };
}

/** One request; `host` overrides the Host header. */
function fetch(s, route, { method = "GET", token = s.token, host = `127.0.0.1:${s.port}` } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: s.port, method, path: `${route}${route.includes("?") ? "&" : "?"}token=${token}`, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body, type: res.headers["content-type"] }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** An SSE stream; `data` holds the lines received so far. */
function stream(s, route) {
  const out = { data: [], events: [] };
  out.req = get({ host: "127.0.0.1", port: s.port, path: `${route}${route.includes("?") ? "&" : "?"}token=${s.token}`, headers: { host: `localhost:${s.port}` } }, (res) => {
    out.status = res.statusCode;
    let buf = "";
    res.on("data", (c) => {
      buf += c;
      const blocks = buf.split("\n\n");
      buf = blocks.pop();
      for (const b of blocks) {
        const ev = /^event: (.*)$/mu.exec(b)?.[1];
        const data = /^data: (.*)$/mu.exec(b)?.[1];
        if (data != null) (ev ? out.events : out.data).push(ev ? [ev, JSON.parse(data)] : JSON.parse(data));
      }
    });
  });
  out.req.on("error", () => {});
  return out;
}

beforeEach(() => {
  home = project();
  pids = [];
});

afterEach(() => {
  for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
});

describe("watch-server.mjs", () => {
  it("writes its address and token to a private server.json, and answers its version", async () => {
    const s = await start();
    expect(statSync(path.join(watch(), "server.json")).mode & 0o777).toBe(0o600);
    expect(s.token).toMatch(/^[0-9a-f]{48}$/u);
    const r = await fetch(s, "/api/version");
    expect(JSON.parse(r.body)).toEqual({ protocol: PROTOCOL, pid: s.pid, tabs: 0 });
  });

  it("refuses a request without the token, or from another Host", async () => {
    const s = await start();
    expect((await fetch(s, "/api/version", { token: "nope" })).status).toBe(403);
    expect((await fetch(s, "/api/version", { host: `evil.test:${s.port}` })).status).toBe(403);
    expect((await fetch(s, "/api/version", { host: "127.0.0.1:1" })).status).toBe(403);
    expect((await fetch(s, "/api/version", { host: `localhost:${s.port}` })).status).toBe(200);
  });

  it("serves the page, with the token in its asset URLs", async () => {
    const s = await start();
    const r = await fetch(s, "/?lang=es");
    expect(r.type).toMatch(/text\/html/u);
    expect(r.body).toContain(`watch.js?token=${s.token}`);
    expect(r.body).toContain('lang="es"');
  });

  it("streams a session's lines, then each appended line", async () => {
    const dir = path.join(watch(), "shop-1234abcd");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "s1.jsonl");
    writeFileSync(file, `${JSON.stringify({ time: 1, event: "SessionStart" })}\n`);
    const s = await start();
    const out = stream(s, "/api/events?repo=shop-1234abcd&session=s1");
    expect(await until(() => out.data.length === 1)).toBe(true);
    appendFileSync(file, `${JSON.stringify({ time: 2, event: "Stop" })}\n{"time":3,`);
    expect(await until(() => out.data.length === 2)).toBe(true);
    appendFileSync(file, `"event":"SessionEnd"}\n`);
    expect(await until(() => out.data.length === 3)).toBe(true);
    expect(out.data.map((e) => e.event)).toEqual(["SessionStart", "Stop", "SessionEnd"]);
    out.req.destroy();
  });

  it("refuses a session path that leaves the watch home", async () => {
    const s = await start();
    expect((await fetch(s, "/api/events?repo=..&session=s1")).status).toBe(400);
    expect((await fetch(s, "/api/events?repo=a&session=../x")).status).toBe(400);
  });

  it("lists the sessions, and counts each open list as a tab", async () => {
    mkdirSync(path.join(watch(), "shop-1234abcd"), { recursive: true });
    writeFileSync(path.join(watch(), "shop-1234abcd", "s1.jsonl"), "{}\n");
    const s = await start();
    const out = stream(s, "/api/sessions");
    expect(await until(() => out.events.length === 1)).toBe(true);
    expect(out.events[0]).toEqual(["sessions", [expect.objectContaining({ repo: "shop-1234abcd", session: "s1" })]]);
    expect(await until(async () => (await version(s))?.tabs === 1)).toBe(true);
    out.req.destroy();
    expect(await until(async () => (await version(s))?.tabs === 0)).toBe(true);
  });

  it("stops itself when no session has written for the idle timeout", async () => {
    const s = await start({ DOCRANK_WATCH_IDLE_MS: "300" });
    expect(await until(() => !alive(s.pid), 5000)).toBe(true);
    expect(existsSync(path.join(watch(), "server.json"))).toBe(false);
  });
});

describe("ensureServer", () => {
  let saved;
  beforeEach(() => {
    saved = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = saved;
  });

  it("starts one when none runs, then reuses it", async () => {
    const a = await ensureServer(0);
    pids.push(state().pid);
    expect(a).toEqual({ port: expect.any(Number), token: expect.any(String), tabs: 0 });
    const b = await ensureServer(0);
    expect(b).toEqual(a);
    expect(pageUrl(a, { lang: "es", repo: "r", session: "s" })).toBe(`http://127.0.0.1:${a.port}/?token=${a.token}&lang=es&repo=r&session=s`);
  });

  it("replaces a server of another protocol", async () => {
    const old = await start({ DOCRANK_WATCH_PROTOCOL_OVERRIDE: String(PROTOCOL + 1) });
    const s = await ensureServer(0);
    pids.push(state().pid);
    expect(await until(() => !alive(old.pid))).toBe(true);
    expect(s.token).not.toBe(old.token);
    expect((await version(s)).protocol).toBe(PROTOCOL);
  });

  it("gives up when the port is held by something else", async () => {
    const holder = createServer().listen(0, "127.0.0.1");
    await new Promise((r) => holder.once("listening", r));
    expect(await ensureServer(holder.address().port)).toBeNull();
    holder.close();
  });
});

describe("the observer at SessionStart", () => {
  it("starts the server and leaves the tab closed when told to", async () => {
    const free = createServer().listen(0, "127.0.0.1");
    await new Promise((r) => free.once("listening", r));
    const port = free.address().port;
    free.close();
    const dir = project({ ".claude/docrank.json": JSON.stringify({ watch: { enabled: true, port } }) });
    const out = await runExit("watch-event.mjs", { hook_event_name: "SessionStart", session_id: "s1", source: "startup" }, dir, { HOME: home, DOCRANK_WATCH_NO_OPEN: "1" });
    expect(out).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(existsSync(path.join(watch(), "server.json"))).toBe(true);
    const s = state();
    pids.push(s.pid);
    expect(s.port).toBe(port);
    expect((await version(s))?.protocol).toBe(PROTOCOL);
  });
});
