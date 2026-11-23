import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { project } from "../testing.mjs";
import { repoKey, toRecord } from "./record.mjs";

const root = "/repo";
const config = { root, gates: { run: [{ name: "test", command: "npm test" }] }, watch: { enabled: true } };
const pre = (tool_name, tool_input, extra = {}) =>
  toRecord({ hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id: "toolu_1", ...extra }, config, 1);

describe("toRecord", () => {
  it("keeps of a Bash call its command and description, redacted, and tags a gate", () => {
    expect(pre("Bash", { command: "npm test", description: "Run tests", timeout: 1 })).toEqual({
      time: 1,
      event: "PreToolUse",
      toolUseId: "toolu_1",
      tool: "Bash",
      input: { command: "npm test", description: "Run tests" },
      gate: "test",
    });
    expect(pre("Bash", { command: "API_KEY=abc node x" }).input.command).toBe("API_KEY=[redacted] node x");
    expect(pre("Bash", { command: 'node "/p/scripts/run-gates.mjs" -C ../w' }).gate).toBe("*");
    expect(pre("Bash", { command: "npm test -- --watch" }).gate).toBeUndefined();
  });

  it("keeps of a file tool its path from the root, never the content", () => {
    expect(pre("Write", { file_path: "/repo/src/a.js", content: "SECRET" }).input).toEqual({ path: "src/a.js" });
    expect(pre("Read", { file_path: "/elsewhere/b.txt" }).input).toEqual({ path: "/elsewhere/b.txt" });
    expect(pre("Edit", { file_path: "/repo/x", old_string: "a", new_string: "b" }).input).toEqual({ path: "x" });
  });

  it("keeps an Agent call's description and type, not its prompt", () => {
    expect(pre("Agent", { description: "Find endpoints", subagent_type: "Explore", prompt: "long" }).input).toEqual({
      description: "Find endpoints",
      subagentType: "Explore",
    });
  });

  it("reads task tools defensively", () => {
    expect(pre("TaskCreate", { subject: "Add login", description: "d", active_form: "Adding login" }).input).toEqual({
      subject: "Add login",
      activeForm: "Adding login",
    });
    expect(pre("TaskUpdate", { task_id: 3, status: "in_progress" }).input).toEqual({ taskId: "3", status: "in_progress" });
    expect(pre("TodoWrite", { todos: [{ content: "A", status: "pending", activeForm: "Doing A" }] }).input).toEqual({
      todos: [{ content: "A", status: "pending", activeForm: "Doing A" }],
    });
    expect(pre("TodoWrite", { todos: "nope" }).input).toEqual({});
  });

  it("keeps nothing of an unknown or MCP tool's input", () => {
    expect(pre("mcp__mail__send", { to: "a@b", body: "token=1" }).input).toEqual({});
    expect(pre("Frobnicate", { x: 1 }).input).toEqual({});
  });

  it("keeps a TaskCreate result's id and nothing else of a result", () => {
    const r = toRecord(
      { hook_event_name: "PostToolUse", tool_name: "TaskCreate", tool_input: { subject: "S" }, tool_use_id: "t", tool_response: { task: { id: "7", subject: "S" } } },
      config,
    );
    expect(r).toMatchObject({ ok: true, taskId: "7" });
    const bash = toRecord(
      { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "cat .env" }, tool_use_id: "t", tool_response: { stdout: "API_KEY=1" } },
      config,
    );
    expect(JSON.stringify(bash)).not.toContain("stdout");
  });

  it("keeps of a failure its exit code, not its output", () => {
    const r = toRecord(
      { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "npm test" }, tool_use_id: "t", error: "Exit code 1\nsecret output" },
      config,
    );
    expect(r).toMatchObject({ ok: false, exitCode: 1, gate: "test" });
    expect(JSON.stringify(r)).not.toContain("secret output");
  });

  it("keeps the verdict of a shell command: passed, failed with its exit code, or failed with none", () => {
    const bash = (event, extra) => toRecord({ hook_event_name: event, tool_name: "Bash", tool_input: { command: "npm test" }, tool_use_id: "t", ...extra }, config, 1);
    const pass = bash("PostToolUse", { tool_response: { stdout: "ok 12", stderr: "", interrupted: false, isImage: false } });
    expect(pass).toEqual({ time: 1, event: "PostToolUse", toolUseId: "t", tool: "Bash", input: { command: "npm test" }, gate: "test", ok: true });
    expect(bash("PostToolUseFailure", { error: "Exit code 0\n" })).toMatchObject({ ok: false, exitCode: 0 });
    const unstarted = bash("PostToolUseFailure", { error: "spawn /bin/zsh ENOENT" });
    expect(unstarted).toMatchObject({ ok: false });
    expect(unstarted).not.toHaveProperty("exitCode");
    // A failed call's PostToolUse carries the error text as its response (fact 26).
    const late = bash("PostToolUse", { tool_response: "Exit code 3\nsecret output" });
    expect(late).toMatchObject({ ok: false, exitCode: 3 });
    expect(JSON.stringify(late)).not.toContain("secret output");
  });

  it("keeps the session-level events small", () => {
    const ev = (hook_event_name, extra = {}) => toRecord({ hook_event_name, ...extra }, config, 1);
    expect(ev("Notification", { notification_type: "permission_prompt", message: "m" })).toEqual({ time: 1, event: "Notification", kind: "permission_prompt" });
    expect(ev("SubagentStart", { agent_id: "a1", agent_type: "Explore" })).toEqual({ time: 1, event: "SubagentStart", agentId: "a1", agentType: "Explore" });
    expect(ev("TaskCreated", { task_id: "1", task_subject: "Add login" })).toEqual({ time: 1, event: "TaskCreated", taskId: "1", subject: "Add login" });
    expect(ev("UserPromptSubmit", { prompt: "my secret plan" })).toEqual({ time: 1, event: "UserPromptSubmit" });
    expect(ev("SessionStart", { source: "startup" })).toEqual({ time: 1, event: "SessionStart", source: "startup", repo: "repo" });
    expect(ev("SessionEnd", { reason: "other" })).toEqual({ time: 1, event: "SessionEnd", reason: "other" });
    expect(ev("PreCompact")).toBeNull();
  });
});

describe("repoKey", () => {
  it("is shared by a repository and its worktrees", () => {
    const dir = project({ "a.txt": "" });
    const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", dir, ...args]);
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "base");
    const wt = `${dir}-wt`;
    git("worktree", "add", "-q", wt);
    expect(repoKey(wt)).toBe(repoKey(dir));
    expect(repoKey(dir)).toMatch(new RegExp(`^${path.basename(dir)}-[0-9a-f]{8}$`, "u"));
  });

  it("falls back to the root outside git", () => {
    expect(repoKey(project())).toMatch(/^docrank-\w+-[0-9a-f]{8}$/u);
  });
});
