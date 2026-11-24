import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FREE, IDLE_MS, NOTICE_MS, closing, reduce, turnNode } from "./reduce.mjs";

/** The watch log of a live trial (harness-facts § 15), paths made generic. */
const fixture = (version) =>
  readFileSync(new URL(`../../test/fixtures/watch-trial-${version}.jsonl`, import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const trial = fixture("0.3.0");
const trial4 = fixture("0.4.0");
/** The 0.5.0 trial, its second prompt (`/stickler:gates` typed) given the command the hook now keeps of it. */
const trial5 = fixture("0.5.0").map((l, i) => (i === 7 ? { ...l, command: "stickler:gates" } : l));

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
  /** A synthetic session with no task tool: three prompts, a helper's notification between them. */
  const log = [
    { time: 1_000, event: "SessionStart", source: "startup", repo: "shop" },
    { time: 10_000, event: "UserPromptSubmit" },
    { time: 11_000, event: "PreToolUse", toolUseId: "a", tool: "Read", input: { path: "README.md" } },
    { time: 11_100, event: "PostToolUse", toolUseId: "a", tool: "Read", input: { path: "README.md" } },
    { time: 12_000, event: "PreToolUse", toolUseId: "g", tool: "Agent", input: { description: "Find the API", subagentType: "Explore" } },
    { time: 12_100, event: "SubagentStart", agentId: "h1", agentType: "Explore" },
    { time: 12_200, event: "PostToolUse", toolUseId: "g", tool: "Agent", input: {} },
    { time: 12_300, event: "Stop" },
    { time: 15_000, event: "PreToolUse", toolUseId: "h", tool: "Grep", input: { pattern: "route" }, agentId: "h1", agentType: "Explore" },
    { time: 16_000, event: "SubagentStop", agentId: "h1", agentType: "Explore" },
    // The helper's result, delivered as a prompt 40 ms later: the same turn.
    { time: 16_040, event: "UserPromptSubmit" },
    { time: 17_000, event: "PreToolUse", toolUseId: "b", tool: "Bash", input: { command: "npm test" } },
    { time: 17_500, event: "PostToolUseFailure", toolUseId: "b", tool: "Bash", ok: false },
    { time: 18_000, event: "Stop" },
    // The user's next prompt, a minute on: a new turn.
    { time: 78_000, event: "UserPromptSubmit" },
    { time: 79_000, event: "PreToolUse", toolUseId: "c", tool: "Edit", input: { path: "src/a.js" } },
    { time: 79_100, event: "PostToolUse", toolUseId: "c", tool: "Edit", input: { path: "src/a.js" } },
    { time: 80_000, event: "Stop" },
    // A prompt answered in words alone is a turn with no action.
    { time: 140_000, event: "UserPromptSubmit" },
    { time: 141_000, event: "Stop" },
  ];

  it("groups the main session's actions by prompt", () => {
    const s = reduce(log);
    expect(s.tasks).toEqual([]);
    expect(s.turns.map((t) => [t.n, t.startedAt, titles(t.actions)])).toEqual([
      [1, 10_000, ["Read:ok", "Agent:ok", "Bash:failed"]],
      [2, 78_000, ["Edit:ok"]],
      [3, 140_000, []],
    ]);
    expect(titles(s.free.actions)).toEqual(["Read:ok", "Agent:ok", "Bash:failed", "Edit:ok"]);
    expect(s.active).toBe(turnNode(2));
  });

  it("hangs a helper from the turn it was sent from", () => {
    const s = reduce(log);
    expect(s.helpers).toEqual([expect.objectContaining({ id: "h1", errand: "Find the API", task: null, turn: 1 })]);
    expect(titles(s.helpers[0].actions)).toEqual(["Grep:running"]);
  });

  it("opens a turn for a prompt that comes after the notice window", () => {
    const late = log.map((e) => (e.time === 16_040 ? { ...e, time: 16_000 + NOTICE_MS + 1 } : e));
    expect(reduce(late).turns.map((t) => titles(t.actions))).toEqual([["Read:ok", "Agent:ok"], ["Bash:failed"], ["Edit:ok"], []]);
  });

  it("takes a helper's hand-back as its result, even before its stop lands", () => {
    const s = reduce([
      ev("UserPromptSubmit"),
      pre("g", "Agent", { subagentType: "Explore" }),
      ev("SubagentStart", { agentId: "h", agentType: "Explore" }),
      pre("x", "SubagentHandback", {}, { agentId: "h", agentType: "Explore" }),
      ev("UserPromptSubmit"),
      ev("SubagentStop", { agentId: "h", agentType: "Explore" }),
      pre("a", "Read"),
    ]);
    expect(s.turns.map((t) => titles(t.actions))).toEqual([["Agent:running", "Read:running"]]);
  });

  it("opens a turn for actions before any prompt", () => {
    const s = reduce([pre("a", "Read"), post("a", "Read")]);
    expect(s.turns).toEqual([expect.objectContaining({ n: 1, actions: [expect.objectContaining({ tool: "Read" })] })]);
    expect(s.active).toBe(turnNode(1));
  });

  it("gives way to a list that appears later: the free node again", () => {
    const s = reduce([...log, ev("UserPromptSubmit"), pre("t", "TaskCreate", { subject: "Ship" }), post("t", "TaskCreate", { subject: "Ship" }, { taskId: "1" })]);
    expect(s.tasks).toHaveLength(1);
    expect(s.active).toBe(FREE);
    expect(titles(s.free.actions).at(-1)).toBe("TaskCreate:ok");
  });
});

describe.each([
  ["0.3.0", () => trial, [2]],
  ["0.4.0", () => trial4, [2]],
  ["0.5.0", () => trial5, [2, 8, 16]],
])("the %s trial's prompts", (_, log, human) => {
  it("open one turn, for the one human prompt; the helpers' notifications open none", () => {
    // Each trial had one prompt (harness-facts § 15); the others are notifications.
    expect(reduce(log()).turns.map((t) => t.startedAt)).toEqual(human.map((k) => log()[k - 1].time));
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

  it("reads a failure from a PostToolUse line that says so, and a gate run's verdict", () => {
    const run = { command: "node scripts/run-gates.mjs" };
    const s = reduce([
      pre("a", "Bash", { command: "npm test" }),
      ev("PostToolUse", { toolUseId: "a", tool: "Bash", ok: false, exitCode: 2 }),
      { ...pre("b", "Bash", run), gate: "*" },
      ev("PostToolUse", { toolUseId: "b", tool: "Bash", ok: true, gate: "*" }),
      { ...pre("c", "Bash", run), gate: "*" },
      ev("PostToolUseFailure", { toolUseId: "c", tool: "Bash", ok: false, exitCode: 1, gate: "*" }),
    ]);
    expect(s.free.actions.map((a) => [a.outcome, a.exitCode ?? null, a.gate])).toEqual([
      ["failed", 2, null],
      ["ok", null, "*"],
      ["failed", 1, "*"],
    ]);
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
      { type: "general-purpose", errand: null, skill: "stickler:gates", task: "2" },
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

  it("works while a helper started in the turn still runs after Stop, then waits for an answer", () => {
    const turn = [ev("UserPromptSubmit"), pre("a", "Agent", { subagentType: "Explore" }), ev("SubagentStart", { agentId: "h", agentType: "Explore" }), ev("Stop")];
    expect(state(turn)).toBe("working");
    // The helper's own calls keep it working only while it runs.
    const worked = [...turn, pre("b", "Read", {}, { agentId: "h" }), post("b", "Read", {}, { agentId: "h" })];
    expect(state(worked)).toBe("working");
    expect(state([...worked, ev("SubagentStop", { agentId: "x" })])).toBe("working");
    expect(state([...worked, ev("SubagentStop", { agentId: "h" })])).toBe("answer");
    // The notification of its end arrives as a prompt: a new turn.
    expect(state([...worked, ev("SubagentStop", { agentId: "h" }), ev("UserPromptSubmit")])).toBe("working");
    // A helper resumed by SendMessage runs again until it stops again.
    const resumed = [...worked, ev("SubagentStop", { agentId: "h" }), ev("SubagentStart", { agentId: "h" }), ev("Stop")];
    expect(state(resumed)).toBe("working");
    expect(state([...resumed, ev("SubagentStop", { agentId: "h" })])).toBe("answer");
    expect(state([...turn, ev("SessionEnd")])).toBe("done");
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

/**
 * The timeline draws `reduce` over the lines up to a point, with no `now`:
 * these hold it to what the live view showed when that line landed.
 */
const feeds = (s) => [s.free, ...s.tasks, ...s.helpers].flatMap((n) => n.actions);

describe.each([
  ["0.3.0", trial],
  ["0.4.0", trial4],
])("a prefix of the %s trial's log, as the timeline draws it", (_, trial) => {
  const at = (k) => reduce(trial.slice(0, k));

  it("is the view the live page had when that line landed", () => {
    for (let k = 1; k <= trial.length; k++) expect(at(k), `line ${k}`).toEqual(reduce(trial.slice(0, k), { now: trial[k - 1].time }));
  });

  it("does not depend on the lines after it, nor change the log", () => {
    const before = JSON.stringify(trial);
    const first = trial.map((_, k) => at(k + 1));
    reduce(trial);
    expect(trial.map((_, k) => at(k + 1))).toEqual(first);
    expect(JSON.stringify(trial)).toBe(before);
  });

  it("only grows: tasks, helpers and actions are never lost as the timeline moves on", () => {
    for (let k = 2; k <= trial.length; k++) {
      const [a, b] = [at(k - 1), at(k)];
      expect(b.tasks.length).toBeGreaterThanOrEqual(a.tasks.length);
      expect(b.helpers.length).toBeGreaterThanOrEqual(a.helpers.length);
      expect(feeds(b).length).toBeGreaterThanOrEqual(feeds(a).length);
    }
  });

  it("ends in the state a past session opens in", () => {
    expect(at(trial.length)).toEqual(reduce(trial, { now: trial.at(-1).time + IDLE_MS * 10 }));
    expect(at(trial.length).state).toBe("done");
  });
});

describe("the 0.3.0 trial's moments, at their lines", () => {
  const at = (k) => reduce(trial.slice(0, k));

  it("shows the trial's moments at their lines", () => {
    expect(at(0)).toMatchObject({ state: "answer", tasks: [], helpers: [] });
    // Line 16, the Agent call: the first task in progress, the call in its feed.
    const dispatched = at(16);
    expect(dispatched).toMatchObject({ state: "working", current: "1" });
    expect(dispatched.tasks.map((t) => t.status)).toEqual(["in_progress", "pending", "pending"]);
    expect(dispatched.helpers).toEqual([]);
    // Line 17, SubagentStart: the helper hangs from that task.
    expect(at(17).helpers).toEqual([expect.objectContaining({ task: "1", status: "working" })]);
    // Line 30, PermissionRequest for the Skill call.
    expect(at(30).state).toBe("permission");
    expect(at(33).state).toBe("working");
    // Line 34, Stop while the gates helper runs: working until its stop at 40.
    for (let k = 34; k <= 39; k++) expect(at(k).state, `line ${k}`).toBe("working");
    expect(at(40).state).toBe("answer");
    // Line 47, the guard's refusal of the push.
    const refused = feeds(at(47)).find((a) => a.outcome === "refused");
    expect(refused).toMatchObject({ tool: "Bash" });
    expect(feeds(at(46)).some((a) => a.outcome === "refused")).toBe(false);
  });
});

describe("the 0.4.0 trial's moments, at their lines", () => {
  const at = (k) => reduce(trial4.slice(0, k));

  it("works while the Explore helper runs past the turn's Stop", () => {
    // Line 17 starts the helper, line 20 ends the turn, line 26 stops the helper.
    expect(at(17).helpers).toEqual([expect.objectContaining({ type: "Explore", task: "1", status: "working" })]);
    for (let k = 17; k <= 26; k++) expect(at(k).state, `line ${k}`).toBe("working");
    // Lines 22 and 33: a stop for an agent never started changes nothing.
    expect(at(22)).toMatchObject({ state: "working", helpers: [expect.objectContaining({ status: "working" })] });
  });

  it("resumes the helper on SendMessage, and keeps one card for it", () => {
    // Line 31, SubagentStart again after SendMessage; line 32 a Stop while it runs.
    expect(at(31).helpers).toHaveLength(1);
    for (let k = 31; k <= 39; k++) expect(at(k).state, `line ${k}`).toBe("working");
  });

  it("hangs the forked gates helper from task 2 and waits for an answer once it stops", () => {
    expect(at(45).helpers[1]).toMatchObject({ skill: "stickler:gates", task: "2", status: "working" });
    for (let k = 48; k <= 54; k++) expect(at(k).state, `line ${k}`).toBe("working");
    // Line 55, the helper stops with the turn already ended; line 56, its notification starts a turn.
    expect(at(55).state).toBe("answer");
    expect(at(56).state).toBe("working");
  });

  it("ends the work in an answer, then done at SessionEnd", () => {
    expect(at(64).tasks.map((t) => t.status)).toEqual(["completed", "completed", "completed"]);
    expect(at(65).state).toBe("answer");
    expect(at(66).state).toBe("answer");
    expect(at(67).state).toBe("done");
  });
});

describe("the 0.5.0 trial: three -p runs of one session, a skill typed as the prompt", () => {
  const s = reduce(trial5);

  it("draws three turns, the gates' helper under the second with the typed skill as its errand", () => {
    expect(s.turns).toHaveLength(3);
    expect(s.tasks).toEqual([]);
    expect(s.helpers).toHaveLength(1);
    expect(s.helpers[0]).toMatchObject({ type: "general-purpose", skill: "stickler:gates", errand: null, turn: 2, status: "done" });
    expect(titles(s.helpers[0].actions)).toEqual(["Bash:ok"]);
    expect(s.helpers[0].actions[0].gate).toBe("*");
  });

  it("reads the third turn's Bash as failed with exit code 3, the first's as passed", () => {
    expect(titles(s.turns[0].actions)).toEqual(["Bash:ok"]);
    expect(s.turns[2].actions).toMatchObject([{ tool: "Bash", outcome: "failed", exitCode: 3 }]);
    expect(s.state).toBe("done");
  });

  it("leaves the helper with no errand in the log as recorded, the prompt's command absent", () => {
    expect(reduce(fixture("0.5.0")).helpers[0]).toMatchObject({ skill: null, errand: null });
  });

  it("sums up: three turns, one general-purpose helper, the gates passed, one failure", () => {
    expect(closing(s)).toEqual({
      tasks: null,
      turns: 3,
      subagents: [{ name: "general-purpose", count: 1 }],
      refusals: [],
      failed: 1,
      gates: [{ name: "*", passed: 1, failed: 0 }],
      duration: 81_964,
    });
  });

  it("gives the typed skill to no helper once its turn is over", () => {
    const later = reduce([...trial5.slice(0, 8), ev("Stop"), { time: trial5[8].time, event: "SubagentStart", agentId: "x", agentType: "general-purpose" }]);
    expect(later.helpers[0].skill).toBeNull();
  });
});

describe("the closing summary", () => {
  it("sums up the 0.3.0 trial: the list done, two helpers, the push refused, the gates passed", () => {
    expect(closing(reduce(trial))).toEqual({
      tasks: { done: 3, total: 3 },
      turns: 1,
      subagents: [
        { name: "Explore", count: 1 },
        { name: "general-purpose", count: 1 },
      ],
      refusals: [{ name: "guard-bash", count: 1 }],
      failed: 0,
      gates: [{ name: "*", passed: 1, failed: 0 }],
      duration: trial.at(-1).time - trial[0].time,
    });
  });

  it("sums up the 0.4.0 trial: no refusal, the gates passed twice", () => {
    expect(closing(reduce(trial4))).toMatchObject({
      tasks: { done: 3, total: 3 },
      subagents: [
        { name: "Explore", count: 1 },
        { name: "general-purpose", count: 1 },
      ],
      refusals: [],
      failed: 0,
      gates: [{ name: "*", passed: 2, failed: 0 }],
      duration: 139_477,
    });
  });

  /** A session with no list where the gates fail, then pass, and a command fails. */
  const t = (s) => 1_000 + s * 1000;
  const run = { command: "node /plugins/stickler/scripts/run-gates.mjs" };
  const failing = [
    { time: t(0), event: "SessionStart", source: "startup", repo: "shop" },
    { time: t(5), event: "UserPromptSubmit" },
    { time: t(6), event: "PreToolUse", toolUseId: "a", tool: "Edit", input: { path: "src/checkout.js" } },
    { time: t(6.2), event: "PostToolUse", toolUseId: "a", tool: "Edit", input: { path: "src/checkout.js" }, ok: true },
    { time: t(7), event: "PreToolUse", toolUseId: "b", tool: "Bash", input: run, gate: "*" },
    { time: t(19), event: "PostToolUseFailure", toolUseId: "b", tool: "Bash", input: run, gate: "*", ok: false, exitCode: 1 },
    { time: t(20), event: "PreToolUse", toolUseId: "c", tool: "Bash", input: { command: "npm run lint -- --fix" } },
    { time: t(23), event: "PostToolUseFailure", toolUseId: "c", tool: "Bash", input: { command: "npm run lint -- --fix" }, ok: false, exitCode: 2 },
    { time: t(26), event: "PreToolUse", toolUseId: "e", tool: "Bash", input: run, gate: "*" },
    { time: t(40), event: "PostToolUse", toolUseId: "e", tool: "Bash", input: run, gate: "*", ok: true },
    { time: t(41), event: "PreToolUse", toolUseId: "f", tool: "Bash", input: { command: "git push" } },
    { time: t(41.1), event: "Refused", toolUseId: "f", tool: "Bash", input: { command: "git push" }, guard: "guard-bash", reason: "no PR" },
    { time: t(42), event: "Stop" },
    { time: t(100), event: "UserPromptSubmit" },
    { time: t(101), event: "PreToolUse", toolUseId: "g", tool: "Read", input: { path: "a.js" } },
    { time: t(101.5), event: "PostToolUseFailure", toolUseId: "g", tool: "Read", input: { path: "a.js" }, interrupted: true },
    { time: t(102), event: "Stop" },
  ];

  it("counts turns with no list, failures with the gates', and an interruption as no failure", () => {
    expect(closing(reduce(failing))).toEqual({
      tasks: null,
      turns: 2,
      subagents: [],
      refusals: [{ name: "guard-bash", count: 1 }],
      failed: 2,
      gates: [{ name: "*", passed: 1, failed: 1 }],
      duration: 102_000,
    });
  });

  it("leaves dropped tasks out, counts a helper with no type, and says nothing of an empty log", () => {
    const s = reduce([
      pre("t", "TodoWrite", { todos: [{ content: "A", status: "completed" }, { content: "B", status: "pending" }] }),
      pre("u", "TodoWrite", { todos: [{ content: "A", status: "completed" }] }),
      ev("SubagentStart", { agentId: "h" }),
    ]);
    expect(closing(s)).toMatchObject({ tasks: { done: 1, total: 1 }, subagents: [{ name: null, count: 1 }] });
    expect(closing(reduce([]))).toEqual({ tasks: null, turns: 0, subagents: [], refusals: [], failed: 0, gates: [], duration: 0 });
  });
});
