/**
 * Which process groups a Claude Code session left running in this repository
 * with nobody to stop them, and stopping them. `hooks/reap.mjs` runs it.
 *
 * A server a session starts in a background shell, or one a test runner
 * starts and is killed before it can stop, keeps running after the session
 * is gone, adopted by PID 1, holding its port and its cores. Nothing else
 * will stop it.
 *
 * A group is stopped only when all of these hold:
 *
 * - **It is the repository's**: a member's working directory is inside one of
 *   its checkouts (`git worktree list`), or inside a removed one beside the
 *   main checkout, named as stickler names worktrees (`<main>-<name>`). The
 *   directory, not the command line, says whose it is: a server may rewrite
 *   its process title, and a test runner starts each server in its package.
 * - **A session started it**: each such member carries a `CLAUDE_PID` (harness
 *   fact 28). A process with none, or whose environment cannot be read, is
 *   left. The variable is inherited, so it also marks whatever was launched
 *   from a session's shell and meant to outlive it (a tmux server, a build
 *   daemon, an editor): `reap.keep` is what protects those.
 * - **Nobody holds it**: its leader is gone or adopted by PID 1, and no
 *   session it names is alive, since a live session may be measuring that
 *   server right now.
 * - **Nothing keeps it**: no member's command line matches `reap.keep`, none
 *   is stickler's own watch server (shared by every session on purpose), and
 *   the group holds neither this process, nor the ending session's, nor an
 *   ancestor of either.
 *
 * When a session ends, its own groups go whether held or not (nobody is left
 * to stop them); `reap.keep`, the watch server and the ancestors still hold.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";

/** stickler's watch server: one per machine, outliving the session that started it. */
const WATCH_SERVER = /watch-server\.mjs/u;

/** Seconds each read may take; past it the run throws and stops nothing. */
export const READ_TIMEOUT_MS = 5000;

/**
 * A command's stdout; a non-zero exit keeps what it printed (`lsof` exits 1
 * when one process could not be read). A timeout throws: half a process
 * table could hide the member that keeps a group, so nothing is reaped.
 */
const out = (cmd, args, options = {}) => {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 << 20,
      timeout: READ_TIMEOUT_MS,
      killSignal: "SIGKILL",
      ...options,
    });
  } catch (e) {
    if (e.code === "ETIMEDOUT" || e.signal) throw new Error(`\`${cmd}\` did not answer in time; nothing stopped`);
    return typeof e.stdout === "string" ? e.stdout : "";
  }
};

/** Whether a command exits 0, within the same limit. */
const succeeds = (cmd, args) => {
  try {
    execFileSync(cmd, args, { stdio: "ignore", timeout: READ_TIMEOUT_MS, killSignal: "SIGKILL" });
    return true;
  } catch {
    return false;
  }
};

/** Every process of this user: pid, parent, group and command line. */
export function processTable() {
  const uid = process.getuid();
  const table = new Map();
  for (const line of out("ps", ["-A", "-ww", "-o", "pid=,ppid=,pgid=,uid=,command="]).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/su.exec(line);
    if (m && Number(m[4]) === uid) table.set(Number(m[1]), { ppid: Number(m[2]), pgid: Number(m[3]), command: m[5].trim() });
  }
  return table;
}

/**
 * The working directory of each of `pids` that could be read. A directory
 * removed since still comes back by its old path: Linux marks it
 * ` (deleted)`, which is cut.
 */
export function directoriesOf(pids) {
  const dirs = new Map();
  if (process.platform === "linux") {
    for (const pid of pids) {
      try {
        dirs.set(pid, readlinkSync(`/proc/${pid}/cwd`).replace(/ \(deleted\)$/u, ""));
      } catch {
        // Gone, or not readable: not known.
      }
    }
    return dirs;
  }
  let pid;
  for (const line of out("lsof", ["-a", "-u", String(process.getuid()), "-d", "cwd", "-Fpn"]).split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pids.has(pid)) dirs.set(pid, line.slice(1));
  }
  return dirs;
}

/**
 * macOS's `ps` no longer prints another process's environment;
 * `sysctl(KERN_PROCARGS2)` still returns it to the same user, and Python's
 * ctypes reaches it with no compiler and no npm dependency. Without `python3`
 * nothing is read, so nothing is stopped.
 *
 * The buffer is argc, the executable's path and its NUL padding, argc
 * arguments, then the environment up to an empty string. Only the
 * environment is searched: an argument reading `CLAUDE_PID=…` is not one.
 */
const MAC_ENV_READER = `
import ctypes, sys
libc = ctypes.CDLL(None)
for pid in sys.argv[1:]:
    mib = (ctypes.c_int * 3)(1, 49, int(pid))
    size = ctypes.c_size_t(0)
    if libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0) != 0: continue
    buf = ctypes.create_string_buffer(size.value)
    if libc.sysctl(mib, 3, buf, ctypes.byref(size), None, 0) != 0: continue
    raw = buf.raw[: size.value]
    if len(raw) < 4: continue
    argc = int.from_bytes(raw[:4], sys.byteorder)
    rest = raw[4:]
    at = rest.find(b"\\0")
    if at < 0: continue
    while at < len(rest) and rest[at] == 0: at += 1
    env = []
    for s in rest[at:].split(b"\\0")[argc:]:
        if not s: break
        env.append(s)
    found = [s[11:] for s in env if s.startswith(b"CLAUDE_PID=")]
    print(pid, int(found[0]) if found and found[0].isdigit() else 0)
`;

/**
 * Whether `python3` here is a real one. On macOS without the Command Line
 * Tools, `/usr/bin/python3` is a stub that offers to install them, in a
 * dialog, instead of running; `xcode-select -p` fails then.
 */
const macPython = () => succeeds("xcode-select", ["-p"]);

/** The `CLAUDE_PID` each of `pids` was started with: a pid, 0 for none; absent when unreadable. */
export function sessionsOf(pids) {
  const sessions = new Map();
  if (pids.length === 0) return sessions;
  if (process.platform === "linux") {
    for (const pid of pids) {
      try {
        const found = readFileSync(`/proc/${pid}/environ`, "latin1").split("\0").find((v) => v.startsWith("CLAUDE_PID="));
        const value = Number(found?.slice("CLAUDE_PID=".length));
        sessions.set(pid, Number.isInteger(value) && value > 0 ? value : 0);
      } catch {
        // Not readable: not known.
      }
    }
    return sessions;
  }
  if (!macPython()) return sessions;
  for (const line of out("python3", ["-I", "-c", MAC_ENV_READER, ...pids.map(String)]).split("\n")) {
    const [pid, session] = line.trim().split(" ").map(Number);
    if (Number.isInteger(pid) && Number.isInteger(session)) sessions.set(pid, session);
  }
  return sessions;
}

export const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/** The repository's checkouts, the main one first; `[root]` outside git. */
export function checkoutsOf(root) {
  const listed = out("git", ["worktree", "list", "--porcelain"], { cwd: root })
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .map((dir) => (existsSync(dir) ? realpathSync(dir) : dir));
  return listed.length > 0 ? listed : [root];
}

const inside = (dir, root) => dir === root || dir.startsWith(`${root}${path.sep}`);

/** This process and each of its ancestors. */
function lineage(table, pid) {
  const chain = [];
  for (let p = pid, hops = 0; p > 1 && hops < 64; hops += 1) {
    chain.push(p);
    p = table.get(p)?.ppid ?? 0;
  }
  return chain;
}

/** The process groups of each of `pids` and of every ancestor of each. */
export function lineageGroups(table, pids) {
  return [...new Set(pids.flatMap((pid) => lineage(table, pid)).map((p) => table.get(p)?.pgid).filter((g) => g !== undefined))];
}

/**
 * The groups to stop, each with a directory that made it the repository's.
 * `session` is the ending session's pid, or undefined for the sweep. `held`
 * adds groups never stopped, read before this run by whoever started it: a
 * detached run at session end may find the session's process already gone.
 * Pure over `reads`, which the tests replace.
 */
export function orphanGroups({ checkouts, session, keep = [], held: before = [], self = process.pid }, reads) {
  const table = reads.table();
  const [main] = checkouts;
  const removed = (dir) => {
    if (main === undefined || !dir.startsWith(`${main}-`)) return false;
    const top = `${main}-${dir.slice(main.length + 1).split(path.sep)[0]}`;
    return !checkouts.includes(top) && !reads.exists(top);
  };
  const ours = (dir) => dir !== "" && (checkouts.some((c) => inside(dir, c)) || removed(dir));

  // Never the group of this process, of the ending session's own process, or
  // of an ancestor of either: the session may still be closing.
  const held = new Set([...before, ...lineageGroups(table, session ? [self, session] : [self])]);
  const keeps = keep.map((source) => new RegExp(source, "u"));
  const kept = (command) => WATCH_SERVER.test(command) || keeps.some((k) => k.test(command));

  const members = new Map();
  for (const [pid, p] of table) {
    if (p.pgid <= 1) continue;
    if (!members.has(p.pgid)) members.set(p.pgid, []);
    members.get(p.pgid).push(pid);
  }

  const dirs = reads.directories(new Set(table.keys()));
  const candidates = [];
  for (const [pgid, pids] of members) {
    if (held.has(pgid)) continue;
    if (pids.some((pid) => kept(table.get(pid).command))) continue;
    const local = pids.filter((pid) => ours(dirs.get(pid) ?? ""));
    if (local.length > 0) candidates.push({ pgid, local });
  }

  const sessions = reads.sessions(candidates.flatMap(({ local }) => local));
  const groups = [];
  for (const { pgid, local } of candidates) {
    const owners = local.map((pid) => sessions.get(pid));
    if (session !== undefined) {
      if (owners.includes(session)) groups.push({ pgid, directory: dirs.get(local[0]) });
      continue;
    }
    // Unreadable, or started outside any session: not proved to be left behind.
    if (owners.some((o) => o === undefined || o === 0)) continue;
    if (owners.some((o) => reads.alive(o))) continue;
    const leader = table.get(pgid);
    if (leader && leader.ppid !== 1) continue;
    groups.push({ pgid, directory: dirs.get(local[0]) });
  }
  return groups;
}

export const systemReads = {
  table: processTable,
  directories: directoriesOf,
  sessions: sessionsOf,
  alive,
  exists: existsSync,
};

/** Stops each group, SIGTERM first and SIGKILL after five seconds; returns those signalled. */
export async function reap(groups) {
  const signal = (pgid, name) => {
    try {
      process.kill(-pgid, name);
      return true;
    } catch {
      return false;
    }
  };
  const sent = groups.filter(({ pgid }) => signal(pgid, "SIGTERM"));
  for (let tries = 0; tries < 25 && sent.some(({ pgid }) => signal(pgid, 0)); tries += 1) await pause(200);
  // Only a group still there: a pgid freed by its last member may be reused.
  for (const { pgid } of sent) if (signal(pgid, 0)) signal(pgid, "SIGKILL");
  return sent;
}
