/** What the plugin's own tests share: a project on disk and a hook run on it. */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PLUGIN_ROOT } from "./agent-types.mjs";

/** A directory outside git holding `files`, relative path to content. */
export function project(files = {}) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "stickler-")));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

/** An agent definition's text. */
export const agent = (front) => `---\n${front}\n---\n\nAn agent.\n`;

/** Runs `hooks/<hook>` on `input` in `dir`; its parsed output, or null when silent. */
export function runHook(hook, input, dir, env = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [path.join(PLUGIN_ROOT, "hooks", hook)],
      { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env } },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim() ? JSON.parse(stdout).hookSpecificOutput : null)),
    );
    child.stdin.end(JSON.stringify({ cwd: dir, ...input }));
  });
}

/** Runs `hooks/<hook>` on `input` in `dir`; its exit status, stdout and stderr, for the hooks that answer by exit code. */
export function runExit(hook, input, dir, env = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [path.join(PLUGIN_ROOT, "hooks", hook)],
      { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env } },
      (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr }),
    );
    child.stdin.end(JSON.stringify({ cwd: dir, ...input }));
  });
}

/** Runs `hooks/<hook>` on `input` in `dir`; its whole parsed output, for the hooks that answer outside `hookSpecificOutput`. */
export function runJson(hook, input, dir) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [path.join(PLUGIN_ROOT, "hooks", hook)],
      { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir } },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim() ? JSON.parse(stdout) : null)),
    );
    child.stdin.end(JSON.stringify({ cwd: dir, ...input }));
  });
}
