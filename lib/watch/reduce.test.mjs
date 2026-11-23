import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FREE, IDLE_MS, reduce } from "./reduce.mjs";

/** The watch log of the 0.3.0 live trial (harness-facts § 15), paths made generic. */
const trial = readFileSync(new URL("../../test/fixtures/watch-trial-0.3.0.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

let clock = 0;
/** One recorded line; `time` ticks so order is visible. */
const ev = (event, fields = {}) => ({ time: ++clock, event, ...fields });
const pre = (id, tool, input = {}, extra = {}) => ev("PreToolUse", { toolUseId: id, tool, input, ...extra });
const post = (id, tool, input = {}, extra = {}) => ev("PostToolUse", { toolUseId: id, tool, input, ok: true, ...extra });

const titles = (feed) => feed.map((a) => `${a.tool}:${a.outcome}`);

describe("tasks from the Task tools", () => {
  const events = [
    ev("SessionStart", { source: "startup", repo: "shop" }),
    ev("UserPromptSubmit"),
    pre("r1", "Read", { path: "README.md" }),
    post("r1", "Read", { path: "README.md" }),
    pre("c1", "TaskCreate", { subject: "Add login", activeForm: "Adding login" }),
    ev("TaskCreated", { taskId: "1", subject: "Add login" }),
    post("c1", "TaskCreate", { subject: "Add login" }, { taskId: "1" }),
    pre("c2", "TaskCreate", { subject: "Write tests" }),
    post("c2", "TaskCreate", { subject: "Write tests" }, { taskId: "2" }),
    pre("u1", "TaskUpdate", { taskId: "1", status: "in_progress" }),
    post("u1", "TaskUpdate", { taskId: "1", status: "in_progress" }),
    pre("e1", "Edit", { path: "src/login.js" }),
    post("e1", "Edit", { path: "src/login.js" }),
    pre("u2", "TaskUpdate", { taskId: "1", status: "completed" }),
    pre("u3", "TaskUpdate", { taskId: "2", status: "in_progress" }),
    pre("b1", "Bash", { command: "npm test" }, { gate: "test" }),
  ];
  const s = reduce(events);

  it("lists each task once, with its subject, active form and status", () => {
    expect(s.tasks.map(({ id, subject, activeForm, status }) => ({ id, subject, activeForm, status }))).toEqual([
      { id: "1", subject: "Add login", activeForm: "Adding login", status: "completed" },
      { id: "2", subject: "Write tests", activeForm: null, status: "in_progress" },
    ]);
    expect(s.current).toBe("2");
    expect(s.repo).toBe("shop");
  });

  it("puts each action in the task in progress when it was made, else in the free node", () => {
    expect(titles(s.free.actions)).toEqual(["Read:ok", "TaskCreate:ok", "TaskCreate:ok", "TaskUpdate:ok", "TaskUpdate:running"]);
    expect(titles(s.tasks[0].actions)).toEqual(["Edit:ok", "TaskUpdate:running"]);
    expect(titles(s.tasks[1].actions)).toEqual(["Bash:running"]);
    expect(s.tasks[1].actions[0].gate).toBe("test");
    expect(s.active).toBe("task:2");
  });

  it("drops a deleted task from the current one", () => {
    const d = reduce([...events, pre("u4", "TaskUpdate", { taskId: "2", status: "deleted" })]);
    expect(d.tasks[1].status).toBe("deleted");
    expect(d.current).toBeNull();
  });
});

describe("tasks from TodoWrite", () => {
  it("replaces the list on each call, by content", () => {
    const s = reduce([
      pre("t1", "TodoWrite", { todos: [{ content: "A", status: "in_progress", activeForm: "Doing A" }, { content: "B", status: "pending" }] }),
      pre("x1", "Grep", { pattern: "foo" }),
      pre("t2", "TodoWrite", { todos: [{ content: "B", status: "in_progress" }] }),
      pre("x2", "Glob", { pattern: "*.js" }),
    ]);
    expect(s.tasks.map((t) => [t.subject, t.status])).toEqual([
      ["A", "deleted"],
      ["B", "in_progress"],
    ]);
    expect(titles(s.tasks[0].actions)).toEqual(["Grep:running", "TodoWrite:running"]);
    expect(titles(s.tasks[1].actions)).toEqual(["Glob:running"]);
  });

  it("ignores a call it cannot read", () => {
    const s = reduce([pre("t1", "TodoWrite", {}), pre("x1", "Read", { path: "a" })]);
    expect(s.tasks).toEqual([]);
    expect(titles(s.free.actions)).toEqual(["TodoWrite:running", "Read:running"]);
  });
});

describe("a session without a list", () => {
  it("keeps every action in the free node", () => {
    const s = reduce([ev("UserPromptSubmit"), pre("a", "Read"), post("a", "Read"), pre("b", "Bash"), post("b", "Bash")]);
    expect(s.tasks).toEqual([]);
    expect(s.current).toBeNull();
    expect(s.active).toBe(FREE);
    expect(titles(s.free.actions)).toEqual(["Read:ok", "Bash:ok"]);
  });
});

describe("pairing calls", () => {
  it("pairs parallel calls by tool_use_id", () => {
    const s = reduce([pre("a", "Read"), pre("b", "Grep"), post("b", "Grep"), ev("PostToolUseFailure", { toolUseId: "a", tool: "Read", ok: false })]);
    expect(titles(s.free.actions)).toEqual(["Read:failed", "Grep:ok"]);
  });

  it("accepts a result before its call, and keeps the result", () => {
    const s = reduce([post("a", "Bash", { command: "ls" }), pre("a", "Bash", { command: "ls" })]);
    expect(s.free.actions).toHaveLength(1);
    expect(s.free.actions[0]).toMatchObject({ outcome: "ok", input: { command: "ls" } });
  });

  it("marks refusals, denials, interruptions and exit codes", () => {
    const s = reduce([
      pre("a", "Bash", { command: "git push" }),
      ev("Refused", { toolUseId: "a", tool: "Bash", guard: "guard-bash", reason: "BLOCKED: gates first" }),
      pre("b", "Bash", { command: "rm -rf x" }),
      ev("PermissionDenied", { toolUseId: "b", tool: "Bash", reason: "[Destructive]" }),
      pre("c", "Bash", { command: "sleep 9" }),
      ev("PostToolUseFailure", { toolUseId: "c", tool: "Bash", ok: false, interrupted: true }),
      pre("d", "Bash", { command: "npm test" }),
      ev("PostToolUseFailure", { toolUseId: "d", tool: "Bash", ok: false, exitCode: 1 }),
    ]);
    expect(s.free.actions.map((a) => a.outcome)).toEqual(["refused", "denied", "interrupted", "failed"]);
    expect(s.free.actions[0]).toMatchObject({ guard: "guard-bash", reason: "BLOCKED: gates first" });
    expect(s.free.actions[3].exitCode).toBe(1);
  });
});

describe("helpers", () => {
  const events = [
    pre("c1", "TaskCreate", { subject: "Research" }),
    post("c1", "TaskCreate", {}, { taskId: "1" }),
    pre("u1", "TaskUpdate", { taskId: "1", status: "in_progress" }),
    pre("g1", "Agent", { description: "Find the API", subagentType: "Explore" }),
    pre("g2", "Agent", { description: "Review the plan", subagentType: "Plan" }),
    ev("SubagentStart", { agentId: "a-plan", agentType: "Plan" }),
    ev("SubagentStart", { agentId: "a-exp", agentType: "Explore" }),
    pre("h1", "Grep", { pattern: "route" }, { agentId: "a-exp", agentType: "Explore" }),
    pre("u2", "TaskUpdate", { taskId: "1", status: "completed" }),
    post("h1", "Grep", {}, { agentId: "a-exp", agentType: "Explore" }),
    ev("SubagentStop", { agentId: "a-exp", agentType: "Explore" }),
    post("g1", "Agent", {}),
    ev("SubagentStop", { agentId: "internal", agentType: "" }),
  ];
  const s = reduce(events);

  it("takes each helper's errand from the oldest Agent call of its type", () => {
    expect(s.helpers.map(({ id, type, errand, status, task }) => ({ id, type, errand, status, task }))).toEqual([
      { id: "a-plan", type: "Plan", errand: "Review the plan", status: "working", task: "1" },
      { id: "a-exp", type: "Explore", errand: "Find the API", status: "done", task: "1" },
    ]);
  });

  it("keeps a helper's actions in its own feed, whatever task is current", () => {
    expect(titles(s.helpers[1].actions)).toEqual(["Grep:ok"]);
    expect(titles(s.tasks[0].actions)).toEqual(["Agent:ok", "Agent:running", "TaskUpdate:running"]);
  });

  it("ignores a SubagentStop for an agent it never saw start", () => {
    expect(s.helpers).toHaveLength(2);
  });

  it("does not start a second helper on a resume", () => {
    const r = reduce([...events, ev("SubagentStart", { agentId: "a-exp", agentType: "Explore" })]);
    expect(r.helpers).toHaveLength(2);
    expect(r.helpers[1].status).toBe("working");
  });

  it("creates a helper from its first action when its start was missed, under no errand", () => {
    const r = reduce([pre("x", "Read", {}, { agentId: "lost", agentType: "Explore" })]);
    expect(r.helpers).toEqual([expect.objectContaining({ id: "lost", type: "Explore", errand: null, task: null })]);
    expect(r.active).toBe("helper:lost");
  });
});

describe("a forked skill's helper", () => {
  it("takes its errand from the Skill call before it, as in the 0.3.0 trial", () => {
    const s = reduce(trial);
    expect(s.helpers.map(({ type, errand, skill, task }) => ({ type, errand, skill, task }))).toEqual([
      { type: "Explore", errand: "Resumir docs/spec.md", skill: null, task: "1" },
      { type: "general-purpose", errand: null, skill: "docrank:gates", task: "2" },
    ]);
    expect(s.helpers[1].actions.map((a) => a.gate ?? a.tool)).toEqual(["*", "Bash"]);
  });

  it("leaves an Agent call of the helper's type to that helper", () => {
    const s = reduce([
      pre("s1", "Skill", { skill: "review" }),
      pre("g1", "Agent", { description: "Fix the bug", subagentType: "general-purpose" }),
      ev("SubagentStart", { agentId: "a1", agentType: "general-purpose" }),
      ev("SubagentStart", { agentId: "a2", agentType: "general-purpose" }),
    ]);
    expect(s.helpers.map(({ errand, skill }) => ({ errand, skill }))).toEqual([
      { errand: "Fix the bug", skill: null },
      { errand: null, skill: "review" },
    ]);
  });

  it("forgets a skill that ran inline once the turn ends", () => {
    const s = reduce([
      pre("s1", "Skill", { skill: "review" }),
      post("s1", "Skill", { skill: "review" }),
      ev("Stop"),
      ev("UserPromptSubmit"),
      ev("SubagentStart", { agentId: "a1", agentType: "general-purpose" }),
    ]);
    expect(s.helpers[0]).toMatchObject({ errand: null, skill: null });
  });
});

describe("the session's state", () => {
  const state = (events, opts) => reduce(events, opts).state;

  it("waits for an answer at the start, works after a prompt or a call", () => {
    expect(state([ev("SessionStart", { source: "startup" })])).toBe("answer");
    expect(state([ev("SessionStart"), ev("UserPromptSubmit")])).toBe("working");
    expect(state([pre("a", "Read")])).toBe("working");
  });

  it("waits for permission from the request until that tool's result", () => {
    const asked = [ev("UserPromptSubmit"), pre("a", "Bash"), ev("PermissionRequest", { tool: "Bash", input: { command: "rm x" } })];
    expect(state(asked)).toBe("permission");
    expect(state([...asked, pre("b", "Read", {}, { agentId: "h" }), post("b", "Read", {}, { agentId: "h" })])).toBe("permission");
    expect(state([...asked, post("a", "Bash")])).toBe("working");
    expect(state([...asked, ev("Refused", { toolUseId: "a", tool: "Bash" })])).toBe("working");
  });

  it("waits for permission on a permission_prompt notification", () => {
    expect(state([ev("UserPromptSubmit"), pre("a", "Bash"), ev("Notification", { kind: "permission_prompt" })])).toBe("permission");
  });

  it("waits for an answer after Stop or idle_prompt, even if a late result lands", () => {
    expect(state([pre("a", "Read"), ev("Stop")])).toBe("answer");
    expect(state([pre("a", "Read"), ev("Stop"), post("a", "Read")])).toBe("answer");
    expect(state([pre("a", "Bash"), ev("PermissionRequest", { tool: "Bash" }), ev("Notification", { kind: "idle_prompt" })])).toBe("answer");
  });

  it("is done at SessionEnd, or after the idle timeout", () => {
    expect(state([pre("a", "Read"), ev("SessionEnd", { reason: "other" }), pre("b", "Read")])).toBe("done");
    const events = [pre("a", "Read"), ev("Stop")];
    const last = events.at(-1).time;
    expect(state(events, { now: last + IDLE_MS - 1 })).toBe("answer");
    expect(state(events, { now: last + IDLE_MS + 1 })).toBe("done");
  });

  it("comes back on a resume after SessionEnd", () => {
    expect(state([ev("SessionEnd"), ev("SessionStart", { source: "resume" }), ev("UserPromptSubmit")])).toBe("working");
  });

  it("ignores lines it cannot read", () => {
    expect(reduce([null, 5, { event: "Mystery" }]).tasks).toEqual([]);
  });
});
