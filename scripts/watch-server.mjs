#!/usr/bin/env node
/**
 * docrank watch's server: one per machine, shared by every session with
 * `watch.enabled` on. It serves the page and its bundle and streams each
 * session's watch log to it as server-sent events, tailing the JSONL files the
 * observer hook appends to. Node built-ins only.
 *
 *   watch-server.mjs [--port <n>]    0 picks a free port (tests)
 *
 * It listens on 127.0.0.1 only. Every request carries the random token it
 * wrote to `server.json` (0600, in the watch home), and its `Host` must be
 * 127.0.0.1 or localhost on the bound port, which a DNS-rebinding page cannot
 * send. It stops itself once no session has written for the idle timeout
 * (`DOCRANK_WATCH_IDLE_MS`, default 30 minutes), and on `POST /api/stop`, the
 * way a session of a newer protocol replaces it (`lib/watch/launch.mjs`).
 */
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IDLE_MS, PROTOCOL, statePath, validRepo, validSession } from "../lib/watch/launch.mjs";
import { watchHome } from "../lib/watch/record.mjs";

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui", "dist");
const POLL_MS = 250;

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const port = Number(arg("--port") ?? 47173);
const idleMs = Number(process.env.DOCRANK_WATCH_IDLE_MS) || IDLE_MS;
// A test stands for an older server with this; nothing else sets it.
const protocol = Number(process.env.DOCRANK_WATCH_PROTOCOL_OVERRIDE) || PROTOCOL;
const token = randomBytes(24).toString("hex");
const started = Date.now();
const home = watchHome();
const streams = new Set(); // the page's session-list streams: one per open tab

const names = new Map(); // a log's path → its checkout's name, once its first line is complete

/**
 * The name of the checkout a session ran in, from the `SessionStart` line the
 * log opens with: the name the page's header shows, where the directory's
 * key carries the main checkout's. Null until that line is there.
 */
function nameOf(file) {
  if (names.has(file)) return names.get(file);
  let head = "";
  try {
    const fd = openSync(file, "r");
    try {
      const buf = Buffer.alloc(4096);
      head = buf.toString("utf8", 0, readSync(fd, buf, 0, buf.length, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  const end = head.indexOf("\n");
  if (end === -1) return null;
  let name = null;
  try {
    const first = JSON.parse(head.slice(0, end));
    if (first?.event === "SessionStart" && typeof first.repo === "string") name = first.repo;
  } catch {}
  names.set(file, name);
  return name;
}

/** Every session log, newest first. */
function sessions() {
  const out = [];
  let repos = [];
  try {
    repos = readdirSync(home, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {}
  for (const r of repos) {
    let files = [];
    try {
      files = readdirSync(path.join(home, r.name)).filter((f) => f.endsWith(".jsonl"));
    } catch {}
    for (const f of files) {
      try {
        const file = path.join(home, r.name, f);
        const st = statSync(file);
        out.push({ repo: r.name, session: f.slice(0, -6), name: nameOf(file), updatedAt: st.mtimeMs, size: st.size });
      } catch {}
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

const sse = (res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  res.write(": open\n\n");
};

/** Streams one session's lines: what is there, then each line as it lands. */
function tail(req, res, file) {
  sse(res);
  let offset = 0;
  let rest = "";
  const read = () => {
    let size;
    try {
      size = statSync(file).size;
    } catch {
      return;
    }
    if (size <= offset) return;
    const fd = openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      const lines = (rest + buf.toString("utf8")).split("\n");
      rest = lines.pop();
      for (const line of lines) if (line.trim()) res.write(`data: ${line}\n\n`);
    } finally {
      closeSync(fd);
    }
  };
  read();
  const timer = setInterval(read, POLL_MS);
  req.on("close", () => clearInterval(timer));
}

/** Streams the session list whenever it changes; an open one is a connected tab. */
function list(req, res) {
  sse(res);
  let last = "";
  const send = () => {
    const now = JSON.stringify(sessions().map(({ size, ...s }) => s));
    if (now !== last) res.write(`event: sessions\ndata: ${now}\n\n`);
    last = now;
  };
  send();
  const timer = setInterval(send, 1000);
  streams.add(res);
  req.on("close", () => {
    clearInterval(timer);
    streams.delete(res);
  });
}

const page = (lang) => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>docrank watch</title><link rel="stylesheet" href="watch.css?token=${token}"></head>
<body><div id="root"></div><script src="watch.js?token=${token}"></script></body></html>`;

function file(res, name, type) {
  const p = path.join(UI, name);
  if (!existsSync(p)) return deny(res, 404, "not built");
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(readFileSync(p));
}

function deny(res, status, message) {
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(message);
}

const server = createServer((req, res) => {
  const bound = server.address().port;
  if (![`127.0.0.1:${bound}`, `localhost:${bound}`].includes(req.headers.host)) return deny(res, 403, "host");
  const url = new URL(req.url, `http://127.0.0.1:${bound}`);
  if (url.searchParams.get("token") !== token) return deny(res, 403, "token");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  const route = `${req.method} ${url.pathname}`;
  switch (route) {
    case "GET /":
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        // React Flow positions its nodes with style attributes.
        "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
      });
      return res.end(page(url.searchParams.get("lang") === "es" ? "es" : "en"));
    case "GET /watch.js":
      return file(res, "watch.js", "text/javascript; charset=utf-8");
    case "GET /watch.css":
      return file(res, "watch.css", "text/css; charset=utf-8");
    case "GET /api/version":
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ protocol, pid: process.pid, tabs: streams.size }));
    case "GET /api/sessions":
      return list(req, res);
    case "GET /api/events": {
      const repo = url.searchParams.get("repo");
      const session = url.searchParams.get("session");
      if (!validRepo(repo) || !validSession(session)) return deny(res, 400, "session");
      return tail(req, res, path.join(home, repo, `${session}.jsonl`));
    }
    case "POST /api/stop":
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("stopping");
      return stop();
    default:
      return deny(res, 404, "not found");
  }
});

/** Removes `server.json` if it is still this server's, then exits. */
function stop() {
  try {
    if (JSON.parse(readFileSync(statePath(), "utf8")).pid === process.pid) rmSync(statePath());
  } catch {}
  for (const res of streams) res.end();
  server.closeAllConnections?.();
  server.close();
  process.exit(0);
}

server.on("error", () => process.exit(1)); // the port is taken: another server answers there
server.listen(port, "127.0.0.1", () => {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const tmp = `${statePath()}.${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ pid: process.pid, port: server.address().port, token, protocol }), { mode: 0o600 });
  renameSync(tmp, statePath());
  setInterval(() => {
    const latest = Math.max(started, sessions()[0]?.updatedAt ?? 0);
    if (Date.now() - latest > idleMs) stop();
  }, Math.min(idleMs / 2, 60_000)).unref();
});
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
