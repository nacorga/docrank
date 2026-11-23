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
 */

/** A session with no event for this long is shown as done. */
export const IDLE_MS = 30 * 60 * 1000;

export const FREE = "free";
export const taskNode = (id) => `task:${id}`;
export const helperNode = (id) => `helper:${id}`;

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
    helpers: [],
  };
  const tasks = new Map();
  const helpers = new Map();
  const calls = new Map();
  const creates = new Map(); // TaskCreate tool_use_id → its input, until the id is known
  const errands = []; // Agent calls no helper has taken yet
  let waiting = null; // the permission a call waits for: { tool, agentId }
  let mode = "answer"; // working, answer or done; a wait for permission shows over it
  let ended = false;

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
   * A helper's errand is the oldest untaken `Agent` call of its type, else of
   * any type: SubagentStart names no description (harness fact 23). A
   * heuristic, right when helpers of one type start in the order asked.
   */
  const helper = (id, type, time) => {
    let h = helpers.get(id);
    if (h) return h;
    let i = errands.findIndex((e) => e.type === (type || "general-purpose"));
    if (i === -1 && errands.length > 0) i = 0;
    const errand = i === -1 ? null : errands.splice(i, 1)[0];
    h = {
      id,
      type: type || errand?.type || null,
      errand: errand?.description ?? null,
      status: "working",
      task: errand ? errand.task : s.current,
      startedAt: time,
      actions: [],
    };
    helpers.set(id, h);
    s.helpers.push(h);
    return h;
  };

  /** The node an action of `agentId` belongs to, and its feed. */
  const home = (agentId, agentType, time) => {
    if (agentId) {
      const h = helper(agentId, agentType, time);
      return [helperNode(h.id), h.actions];
    }
    if (s.current != null) return [taskNode(s.current), tasks.get(s.current).actions];
    return [FREE, s.free.actions];
  };

  const call = (e) => {
    const known = calls.get(e.toolUseId);
    if (known) {
      if (!known.input || Object.keys(known.input).length === 0) known.input = e.input ?? known.input;
      known.gate ??= e.gate;
      return known;
    }
    const [node, feed] = home(e.agentId, e.agentType, e.time);
    const a = { id: e.toolUseId ?? null, tool: e.tool ?? null, input: e.input ?? {}, gate: e.gate ?? null, time: e.time, outcome: "running", node };
    feed.push(a);
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
        waiting = null;
        mode = "working";
        break;
      case "PreToolUse": {
        mode = "working";
        const fresh = !calls.has(e.toolUseId);
        call(e);
        if (fresh && TASK_TOOLS.has(e.tool)) taskTool(e);
        if (fresh && e.tool === "Agent") {
          errands.push({ id: e.toolUseId, description: e.input?.description ?? null, type: e.input?.subagentType || "general-purpose", task: e.agentId ? helpers.get(e.agentId)?.task ?? s.current : s.current });
        }
        break;
      }
      case "PostToolUse": {
        const fresh = !calls.has(e.toolUseId);
        const a = call(e);
        if (fresh && TASK_TOOLS.has(e.tool)) taskTool(e);
        settle(a, "ok");
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
          s.active = helperNode(e.agentId);
          mode = "working";
        }
        break;
      case "SubagentStop": {
        const h = helpers.get(e.agentId);
        if (h) h.status = "done";
        break;
      }
      case "TaskCreated":
        if (e.taskId) {
          const pending = [...creates.values()].find((i) => i.subject === e.subject);
          task(e.taskId, { subject: e.subject, activeForm: pending?.activeForm });
        }
        break;
      case "Stop":
        waiting = null;
        mode = "answer";
        break;
      case "SessionEnd":
        waiting = null;
        ended = true;
        mode = "done";
        break;
      default:
        break;
    }

    s.current = current();
  }

  // A result that lands after Stop does not bring the session back to work:
  // only a new call, prompt or helper does. Async lines can arrive late.
  s.state = waiting && !ended ? "permission" : mode;
  if (now != null && s.lastAt != null && now - s.lastAt > idleMs) s.state = "done";
  return s;
}
