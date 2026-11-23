/**
 * Turns a session's watch log into what the page draws: the session's state,
 * its tasks, the helpers it dispatched and, for each of those nodes, the feed
 * of its actions. Pure ESM with no import, shared by the server's tests and
 * the browser bundle, so the live view and a replay are the same function
 * over the same lines.
 *
 * The log comes from async hooks, separate processes with no order between
 * them (harness fact 19): a call's `PostToolUse` may precede its `PreToolUse`.
 * A call is therefore keyed by `tool_use_id` and built from whichever line
 * comes first; a later line fills in, never resets, what is known.
 *
 * A session with no task list groups the main session's actions by turn, one
 * per prompt. A list that appears later takes over: the page then draws the
 * tasks and the free node, and the turns stay as data.
 */

/** A session with no event for this long is shown as done. */
export const IDLE_MS = 30 * 60 * 1000;

export const FREE = "free";
export const taskNode = (id) => `task:${id}`;
export const helperNode = (id) => `helper:${id}`;
export const turnNode = (n) => `turn:${n}`;

/**
 * A prompt this soon after a helper's result is that result's notification,
 * not the user's: it opens no turn. In both trials (harness-facts § 15) a
 * background helper's result reached Claude as a `UserPromptSubmit` with no
 * prompt in it, 4 ms to 2.2 s after the helper's `SubagentStop` or its
 * `SubagentHandback` call, while the session's one human prompt came 20 s
 * and more after anything else. The prompt's text is not stored, so this is a
 * heuristic: a prompt the user sends within this window of a result joins the
 * turn before it, and a notification whose helper's last line lands after it
 * (async hooks, fact 19) opens a turn.
 */
export const NOTICE_MS = 5000;

const TASK_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TodoWrite"]);

/**
 * `events`, oldest first, to the session view. `now` decides whether a quiet
 * session is done; leave it out to judge by the events alone.
 */
export function reduce(events, { now, idleMs = IDLE_MS } = {}) {
  const s = {
    state: "answer",
    repo: null,
    startedAt: null,
    lastAt: null,
    current: null,
    active: FREE,
    tasks: [],
    free: { actions: [] },
    turns: [],
    helpers: [],
  };
  const tasks = new Map();
  const helpers = new Map();
  const calls = new Map();
  const creates = new Map(); // TaskCreate tool_use_id → its input, until the id is known
  const errands = []; // Agent and Skill calls no helper has taken yet
  let waiting = null; // the permission a call waits for: { tool, agentId }
  let mode = "answer"; // working, answer or done; a wait for permission shows over it
  const running = new Set(); // helpers started and not stopped: Claude waits for them, not for an answer
  let ended = false;
  let turn = null; // the turn the main session's free actions go to
  let resultAt = null; // when a helper last handed back a result

  const openTurn = (time) => {
    turn = { n: s.turns.length + 1, startedAt: time ?? null, actions: [] };
    s.turns.push(turn);
    return turn;
  };

  const task = (id, fields = {}) => {
    let t = tasks.get(id);
    if (!t) {
      t = { id, subject: null, activeForm: null, status: "pending", actions: [], updatedAt: 0 };
      tasks.set(id, t);
      s.tasks.push(t);
    }
    for (const [k, v] of Object.entries(fields)) if (v != null) t[k] = v;
    return t;
  };

  const current = () => {
    let best = null;
    for (const t of s.tasks) if (t.status === "in_progress" && (!best || t.updatedAt >= best.updatedAt)) best = t;
    return best?.id ?? null;
  };

  const setStatus = (t, status, time) => {
    if (!status) return;
    t.status = status;
    t.updatedAt = time;
  };

  /**
   * A helper's errand is the oldest untaken `Agent` call of its type, else the
   * oldest untaken `Skill` call (a skill with `context: fork` starts a helper
   * with no `Agent` call), else the oldest `Agent` call of any type:
   * SubagentStart names no description (harness fact 23). A heuristic, right
   * when helpers start in the order asked; a `Skill` call that ran inline is
   * forgotten when the turn ends, and until then a helper with no call of its
   * own may take it.
   */
  const helper = (id, type, time) => {
    let h = helpers.get(id);
    if (h) return h;
    let i = errands.findIndex((e) => e.kind === "agent" && e.type === (type || "general-purpose"));
    if (i === -1) i = errands.findIndex((e) => e.kind === "skill");
    if (i === -1) i = errands.findIndex((e) => e.kind === "agent");
    const errand = i === -1 ? null : errands.splice(i, 1)[0];
    h = {
      id,
      type: type || errand?.type || null,
      errand: errand?.description ?? null,
      skill: errand?.skill ?? null,
      status: "working",
      task: errand ? errand.task : s.current,
      turn: errand ? errand.turn : turn?.n ?? null,
      startedAt: time,
      actions: [],
    };
    helpers.set(id, h);
    s.helpers.push(h);
    running.add(id);
    return h;
  };

  /**
   * The node an action of `agentId` belongs to, and its feeds: a helper's, the
   * current task's, else the free node's and its turn's.
   */
  const home = (agentId, agentType, time) => {
    if (agentId) {
      const h = helper(agentId, agentType, time);
      return [helperNode(h.id), [h.actions]];
    }
    if (s.current != null) return [taskNode(s.current), [tasks.get(s.current).actions]];
    const t = turn ?? openTurn(time);
    return [s.tasks.length > 0 ? FREE : turnNode(t.n), [s.free.actions, t.actions]];
  };

  const call = (e) => {
    const known = calls.get(e.toolUseId);
    if (known) {
      if (!known.input || Object.keys(known.input).length === 0) known.input = e.input ?? known.input;
      known.gate ??= e.gate ?? null;
      return known;
    }
    const [node, feeds] = home(e.agentId, e.agentType, e.time);
    const a = { id: e.toolUseId ?? null, tool: e.tool ?? null, input: e.input ?? {}, gate: e.gate ?? null, time: e.time, outcome: "running", node };
    for (const feed of feeds) feed.push(a);
    if (e.toolUseId) calls.set(e.toolUseId, a);
    s.active = node;
    return a;
  };

  const settle = (a, outcome, extra = {}) => {
    if (a.outcome === "running") a.outcome = outcome;
    Object.assign(a, extra);
  };

  const clearWait = (tool, agentId) => {
    if (waiting && waiting.tool === tool && (waiting.agentId ?? null) === (agentId ?? null)) waiting = null;
  };

  /** The task and turn a call's helper would hang from: its caller's. */
  const callerTask = (e) => (e.agentId ? helpers.get(e.agentId)?.task ?? s.current : s.current);
  const callerTurn = (e) => (e.agentId ? helpers.get(e.agentId)?.turn ?? turn?.n : turn?.n) ?? null;

  /** A turn has ended: a skill not forked by now ran inline. */
  const endTurn = () => {
    for (let i = errands.length - 1; i >= 0; i--) if (errands[i].kind === "skill") errands.splice(i, 1);
  };

  /** What the task tools say about the list, read when the call is made. */
  const taskTool = (e) => {
    const i = e.input ?? {};
    if (e.tool === "TaskCreate") {
      if (e.toolUseId) creates.set(e.toolUseId, i);
    } else if (e.tool === "TaskUpdate" && i.taskId) {
      const t = task(i.taskId, { subject: i.subject, activeForm: i.activeForm });
      setStatus(t, i.status, e.time);
    } else if (e.tool === "TodoWrite" && Array.isArray(i.todos)) {
      const seen = new Set();
      for (const todo of i.todos) {
        if (!todo?.content) continue;
        const id = `todo:${todo.content}`;
        seen.add(id);
        const t = task(id, { subject: todo.content, activeForm: todo.activeForm });
        if (t.status !== todo.status) setStatus(t, todo.status, e.time);
      }
      for (const t of s.tasks) if (t.id.startsWith("todo:") && !seen.has(t.id)) setStatus(t, "deleted", e.time);
    }
  };

  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    s.startedAt ??= e.time ?? null;
    s.lastAt = e.time ?? s.lastAt;
    if (ended && e.event !== "SessionStart") continue;

    switch (e.event) {
      case "SessionStart":
        ended = false;
        s.repo = e.repo ?? s.repo;
        mode = "answer";
        break;
      case "UserPromptSubmit":
        if (!(resultAt != null && e.time != null && e.time - resultAt <= NOTICE_MS)) openTurn(e.time);
        endTurn();
        waiting = null;
        mode = "working";
        break;
      case "PreToolUse": {
        // A helper's call keeps the session working through `running`, and
        // only while that helper runs: it does not undo the turn's Stop.
        if (!e.agentId) mode = "working";
        if (e.agentId && e.tool === "SubagentHandback") resultAt = e.time ?? resultAt;
        const fresh = !calls.has(e.toolUseId);
        call(e);
        if (fresh && TASK_TOOLS.has(e.tool)) taskTool(e);
        if (fresh && e.tool === "Agent") {
          errands.push({ kind: "agent", description: e.input?.description ?? null, type: e.input?.subagentType || "general-purpose", task: callerTask(e), turn: callerTurn(e) });
        }
        if (fresh && e.tool === "Skill" && e.input?.skill) errands.push({ kind: "skill", skill: e.input.skill, type: null, task: callerTask(e), turn: callerTurn(e) });
        break;
      }
      case "PostToolUse": {
        if (e.agentId && e.tool === "SubagentHandback") resultAt = e.time ?? resultAt;
        const fresh = !calls.has(e.toolUseId);
        const a = call(e);
        if (fresh && TASK_TOOLS.has(e.tool)) taskTool(e);
        settle(a, e.ok === false ? "failed" : "ok", e.exitCode != null ? { exitCode: e.exitCode } : {});
        if (e.tool === "TaskCreate" && e.taskId) {
          const i = creates.get(e.toolUseId) ?? e.input ?? {};
          task(e.taskId, { subject: i.subject, activeForm: i.activeForm });
        }
        clearWait(e.tool, e.agentId);
        break;
      }
      case "PostToolUseFailure":
        settle(call(e), e.interrupted ? "interrupted" : "failed", e.exitCode != null ? { exitCode: e.exitCode } : {});
        clearWait(e.tool, e.agentId);
        break;
      case "Refused":
        settle(call(e), "refused", { reason: e.reason ?? null, guard: e.guard ?? null });
        clearWait(e.tool, e.agentId);
        break;
      case "PermissionDenied":
        settle(call(e), "denied", { reason: e.reason ?? null });
        clearWait(e.tool, e.agentId);
        break;
      case "PermissionRequest":
        waiting = { tool: e.tool, agentId: e.agentId ?? null };
        break;
      case "Notification":
        if (e.kind === "permission_prompt") waiting ??= { tool: null, agentId: null };
        else if (e.kind === "idle_prompt") {
          waiting = null;
          mode = "answer";
        }
        break;
      case "SubagentStart":
        if (e.agentId) {
          helper(e.agentId, e.agentType, e.time).status = "working";
          running.add(e.agentId); // a resumed helper runs again
          s.active = helperNode(e.agentId);
          mode = "working";
        }
        break;
      case "SubagentStop": {
        const h = helpers.get(e.agentId);
        if (h) {
          h.status = "done";
          resultAt = e.time ?? resultAt;
        }
        running.delete(e.agentId);
        break;
      }
      case "TaskCreated":
        if (e.taskId) {
          const pending = [...creates.values()].find((i) => i.subject === e.subject);
          task(e.taskId, { subject: e.subject, activeForm: pending?.activeForm });
        }
        break;
      case "Stop":
        endTurn();
        waiting = null;
        mode = "answer";
        break;
      case "SessionEnd":
        waiting = null;
        running.clear();
        ended = true;
        mode = "done";
        break;
      default:
        break;
    }

    s.current = current();
  }

  // Once a list appears, the page draws no turn: the free node stands in.
  if (s.tasks.length > 0 && s.active.startsWith("turn:")) s.active = FREE;

  // A result that lands after Stop does not bring the session back to work:
  // only a new call, prompt or helper does. Async lines can arrive late.
  // A turn may end while a helper it started still runs (the 0.4.0 trial):
  // Claude then waits for the helper, so the session works until the last
  // one stops.
  s.state = waiting && !ended ? "permission" : mode === "answer" && running.size > 0 ? "working" : mode;
  if (now != null && s.lastAt != null && now - s.lastAt > idleMs) s.state = "done";
  return s;
}
