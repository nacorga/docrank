import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_ROOT } from "../lib/agent-types.mjs";
import { project, runExit, runHook } from "../lib/testing.mjs";

const on = { watch: { enabled: true }, gates: { run: [{ name: "test", command: "npm test" }] } };

/** A repository and a sandbox HOME; `fire` runs the hook there. */
function sandbox(config = on) {
  const dir = project(config == null ? {} : { ".claude/docrank.json": typeof config === "string" ? config : JSON.stringify(config) });
  const home = project();
  const fire = (input) => runExit("watch-event.mjs", { session_id: "s1", ...input }, dir, { HOME: home });
  const watch = path.join(home, ".claude", "docrank", "watch");
  const lines = () => {
    if (!existsSync(watch)) return [];
    const [repo] = readdirSync(watch);
    const file = path.join(watch, repo, "s1.jsonl");
    return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  };
  return { dir, home, watch, fire, lines };
}

describe("watch-event.mjs", () => {
  it("writes nothing, prints nothing and exits 0 while watch is off", async () => {
    const s = sandbox(null);
    const out = await s.fire({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_use_id: "t" });
    expect(out).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(existsSync(s.watch)).toBe(false);
  });

  it("fails open on an invalid config, on bad input and on an unusable session id", async () => {
    const bad = sandbox({ watch: { enabled: "yes" } });
    expect(await bad.fire({ hook_event_name: "Stop" })).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(existsSync(bad.watch)).toBe(false);

    const s = sandbox();
    expect(await s.fire({ hook_event_name: "Stop", session_id: "../../evil" })).toMatchObject({ status: 0, stdout: "" });
    expect(existsSync(s.watch)).toBe(false);
  });

  it("fails open on input that is not JSON", async () => {
    const s = sandbox();
    const { execFile } = await import("node:child_process");
    const status = await new Promise((resolve) => {
      const child = execFile(process.execPath, [path.join(PLUGIN_ROOT, "hooks", "watch-event.mjs")], { cwd: s.dir, env: { ...process.env, HOME: s.home } }, (e, stdout) =>
        resolve({ code: e ? e.code : 0, stdout }),
      );
      child.stdin.end("{not json");
    });
    expect(status).toEqual({ code: 0, stdout: "" });
  });

  it("appends one redacted line per event, in a private file", async () => {
    const s = sandbox();
    await s.fire({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "TOKEN=abc npm test" }, tool_use_id: "t1" });
    await s.fire({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "npm test" }, tool_use_id: "t1", error: "Exit code 1\nboom" });
    await s.fire({ hook_event_name: "Notification", notification_type: "idle_prompt", message: "waiting" });
    const [a, b, c] = s.lines();
    expect(a).toMatchObject({ event: "PreToolUse", tool: "Bash", toolUseId: "t1", input: { command: "TOKEN=[redacted] npm test" } });
    expect(b).toMatchObject({ event: "PostToolUseFailure", ok: false, exitCode: 1, gate: "test" });
    expect(c).toMatchObject({ event: "Notification", kind: "idle_prompt" });
    const [repo] = readdirSync(s.watch);
    expect(statSync(path.join(s.watch, repo)).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(s.watch, repo, "s1.jsonl")).mode & 0o777).toBe(0o600);
  });

  it("records whether a command passed or failed, and its exit code, never its output", async () => {
    const s = sandbox();
    const cmd = { command: "npm test" };
    await s.fire({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: cmd, tool_use_id: "p", tool_response: { stdout: "all 12 passed", stderr: "", interrupted: false, isImage: false } });
    await s.fire({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: cmd, tool_use_id: "f", error: "Exit code 2\nError: secret detail", is_interrupt: false });
    await s.fire({ hook_event_name: "PostToolUseFailure", tool_name: "Read", tool_input: { file_path: `${s.dir}/missing` }, tool_use_id: "r", error: "File does not exist." });
    const [pass, fail, read] = s.lines();
    expect(pass).toMatchObject({ toolUseId: "p", ok: true, gate: "test" });
    expect(pass).not.toHaveProperty("exitCode");
    expect(fail).toMatchObject({ toolUseId: "f", ok: false, exitCode: 2, gate: "test" });
    expect(read).toMatchObject({ toolUseId: "r", tool: "Read", ok: false });
    expect(read).not.toHaveProperty("exitCode");
    const raw = readFileSync(path.join(s.watch, readdirSync(s.watch)[0], "s1.jsonl"), "utf8");
    for (const out of ["all 12 passed", "secret detail", "does not exist"]) expect(raw).not.toContain(out);
  });
});

describe("a guard's refusal reaches the watch log", () => {
  it("from a JSON guard", async () => {
    const s = sandbox();
    const out = await runHook("guard-paths.mjs", { session_id: "s1", tool_name: "Edit", tool_input: { file_path: `${s.dir}/.env` }, tool_use_id: "t9" }, s.dir, { HOME: s.home });
    expect(out.permissionDecision).toBe("deny");
    expect(s.lines()).toEqual([expect.objectContaining({ event: "Refused", guard: "guard-paths", toolUseId: "t9", tool: "Edit", input: { path: ".env" } })]);
  });

  it("from the Bash guard", async () => {
    const s = sandbox();
    const out = await runExit("guard-bash.mjs", { session_id: "s1", tool_name: "Bash", tool_input: { command: "git reset --hard" }, tool_use_id: "t8" }, s.dir, { HOME: s.home });
    expect(out.status).toBe(2);
    expect(s.lines()).toEqual([expect.objectContaining({ event: "Refused", guard: "guard-bash", toolUseId: "t8", input: { command: "git reset --hard" } })]);
  });

  it("not while watch is off", async () => {
    const s = sandbox(null);
    await runHook("guard-paths.mjs", { session_id: "s1", tool_name: "Edit", tool_input: { file_path: `${s.dir}/.env` }, tool_use_id: "t9" }, s.dir, { HOME: s.home });
    expect(existsSync(s.watch)).toBe(false);
  });
});

describe("hooks.json", () => {
  const { hooks } = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8"));
  const watchers = (event) =>
    (hooks[event] ?? []).flatMap((group) => group.hooks.filter((h) => h.command.includes("watch-event.mjs")).map((h) => ({ ...h, matcher: group.matcher })));

  it.each([
    ["PreToolUse", "*"],
    ["PostToolUse", "*"],
    ["PostToolUseFailure", "*"],
    ["PermissionRequest", "*"],
    ["PermissionDenied", "*"],
    ["Notification", undefined],
    ["SubagentStart", undefined],
    ["SubagentStop", undefined],
    ["TaskCreated", undefined],
    ["UserPromptSubmit", undefined],
    ["Stop", undefined],
    ["SessionStart", undefined],
    ["SessionEnd", undefined],
  ])("wires the observer on %s, async, matching every tool", (event, matcher) => {
    expect(watchers(event)).toEqual([{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/watch-event.mjs"', async: true, matcher }]);
  });
});
