/**
 * Finds or starts the one watch server of the machine, and opens its page.
 * Shared by the observer hook at `SessionStart` and by `stickler watch`.
 *
 * The server is found through `server.json` in the watch home and asked its
 * protocol. A server of another protocol, left by another stickler version, is
 * stopped and replaced; one that does not answer is replaced too. A new one is
 * spawned detached, with no stdio, so it outlives the hook process, which
 * Claude Code kills at the end of a `-p` run (harness fact 19).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { watchHome } from "./record.mjs";

export { IDLE_MS } from "./reduce.mjs";

/** Raised when the server's routes or the log's lines change shape. */
export const PROTOCOL = 2; // 2: the session list carries each session's start, state and task count

export const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "watch-server.mjs");
export const statePath = () => path.join(watchHome(), "server.json");
export const validRepo = (r) => typeof r === "string" && /^[\w.-]{1,200}$/u.test(r) && !/^\.+$/u.test(r);
export const validSession = (s) => typeof s === "string" && /^[\w-]{1,128}$/u.test(s);

export function readState() {
  try {
    const s = JSON.parse(readFileSync(statePath(), "utf8"));
    return Number.isInteger(s.port) && typeof s.token === "string" ? s : null;
  } catch {
    return null;
  }
}

/** One request to the server; null when it does not answer. */
export function ask(state, method, route) {
  return new Promise((resolve) => {
    const req = request(
      { host: "127.0.0.1", port: state.port, method, path: `${route}?token=${state.token}`, headers: { host: `127.0.0.1:${state.port}` }, timeout: 1000 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end();
  });
}

/** What the server says of itself: `{ protocol, pid, tabs }`, or null. */
export async function version(state) {
  if (!state) return null;
  const r = await ask(state, "GET", "/api/version");
  try {
    return r?.status === 200 ? JSON.parse(r.body) : null;
  } catch {
    return null;
  }
}

/**
 * The running server of this protocol, started on `port` when there is none.
 * Resolves to `{ port, token, tabs }`, or null when none could be started
 * (the port is held by something else). `retentionDays` goes to a server it
 * starts; one already running keeps its own.
 */
export async function ensureServer(port, { env = {}, retentionDays } = {}) {
  const old = readState();
  const v = await version(old);
  if (v?.protocol === PROTOCOL) return { port: old.port, token: old.token, tabs: v.tabs };
  if (v) {
    await ask(old, "POST", "/api/stop");
    for (let i = 0; i < 40 && (await version(old)); i++) await sleep(50);
  }
  const args = [SERVER, "--port", String(port)];
  if (retentionDays) args.push("--retention-days", String(retentionDays));
  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore", env: { ...process.env, ...env } });
  child.unref();
  let exited = false;
  child.on("exit", () => (exited = true));
  for (let i = 0; i < 100 && !exited; i++) {
    await sleep(50);
    const s = readState();
    if (s?.pid === child.pid) return { port: s.port, token: s.token, tabs: 0 };
  }
  return null;
}

/** The page's address; `repo` and `session` make it follow that session. */
export function pageUrl({ port, token }, { lang = "en", repo, session } = {}) {
  const q = new URLSearchParams({ token, lang });
  if (repo) q.set("repo", repo);
  if (session) q.set("session", session);
  return `http://127.0.0.1:${port}/?${q}`;
}

/**
 * Opens `url` in the default browser, unless the machine has no screen to
 * open it on: under CI, over SSH, or with `STICKLER_WATCH_NO_OPEN` set (tests).
 * No hook input tells a `-p` run apart (harness fact 23).
 */
export function openTab(url, env = process.env) {
  if (env.CI || env.SSH_CONNECTION || env.STICKLER_WATCH_NO_OPEN) return false;
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    const child = spawn(cmd, [url], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
