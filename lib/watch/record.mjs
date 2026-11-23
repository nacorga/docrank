/**
 * What docrank watch keeps of a hook event, and where. One JSON line per event
 * in `~/.claude/docrank/watch/<repo key>/<session_id>.jsonl`, outside every
 * repository, the directory 0700 and the file 0600.
 *
 * A line holds what the view draws and nothing else: no tool output, no
 * prompt, no file content. The input of a call is cut down to the fields its
 * sentence names (a command, a path, a task's subject), each redacted and
 * length-capped. From a result, only a task's id and the verdict are kept:
 * whether the call failed and, for a shell command, its exit code.
 */
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../git.mjs";
import { clip } from "./redact.mjs";

export const watchHome = () => path.join(os.homedir(), ".claude", "docrank", "watch");

/**
 * The directory name of a repository: its main checkout's name and a short
 * hash of its path, so worktrees of one repository share it and two
 * checkouts of the same name do not.
 */
export function repoKey(root) {
  const common = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const main = common && path.basename(common) === ".git" ? path.dirname(common) : root;
  const hash = createHash("sha256").update(main).digest("hex").slice(0, 8);
  return `${path.basename(main).replace(/[^\w.-]/gu, "_")}-${hash}`;
}

const safeId = (id) => (typeof id === "string" && /^[\w-]{1,128}$/u.test(id) ? id : null);

/** A path as the observer reads it: from the repository root when inside it. */
function shown(file, root) {
  if (typeof file !== "string") return undefined;
  const rel = path.relative(root, file);
  return clip(rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : file, 200);
}

/** `taskId`, read defensively: the model may write `id` or `task_id` ([sdk-todo]). */
const taskIdOf = (i) => i.taskId ?? i.id ?? i.task_id;

/** The fields of a tool's input that its sentence names. Unknown and MCP tools keep none. */
function summary(tool, i, root) {
  if (!i || typeof i !== "object") return {};
  switch (tool) {
    case "Bash":
    case "PowerShell":
    case "Monitor":
      return { command: clip(i.command, 500), description: clip(i.description, 200) };
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return { path: shown(i.file_path ?? i.notebook_path, root) };
    case "Glob":
      return { pattern: clip(i.pattern, 200), path: shown(i.path, root) };
    case "Grep":
      return { pattern: clip(i.pattern, 200), path: shown(i.path, root), glob: clip(i.glob, 100) };
    case "WebFetch":
      return { url: clip(i.url, 300) };
    case "WebSearch":
      return { query: clip(i.query, 200) };
    case "Agent":
      return { description: clip(i.description, 200), subagentType: clip(i.subagent_type, 100) };
    case "Skill":
      return { skill: clip(i.skill ?? i.command, 100) };
    case "SendMessage":
      return { to: clip(i.to, 100) };
    case "TaskCreate":
      return { subject: clip(i.subject, 200), activeForm: clip(i.activeForm ?? i.active_form, 200) };
    case "TaskUpdate":
      return {
        taskId: clip(String(taskIdOf(i) ?? ""), 50) || undefined,
        status: clip(i.status, 20),
        subject: clip(i.subject, 200),
        activeForm: clip(i.activeForm ?? i.active_form, 200),
      };
    case "TodoWrite":
      return Array.isArray(i.todos)
        ? {
            todos: i.todos.slice(0, 50).map((t) => ({
              content: clip(t?.content, 200),
              status: clip(t?.status, 20),
              activeForm: clip(t?.activeForm ?? t?.active_form, 200),
            })),
          }
        : {};
    default:
      return {};
  }
}

/** The gate a Bash command runs: a `gates.run` command exactly, or the gates runner (`*`). */
function gateOf(command, gates) {
  if (typeof command !== "string") return undefined;
  const c = command.trim();
  if (/\bscripts\/run-gates\.mjs\b/u.test(c)) return "*";
  return gates.run.find((g) => g.command.trim() === c)?.name;
}

/** A shell command's exit code from the `Exit code N` first line of a failure's text (fact 26). */
function exitCodeOf(error) {
  const code = /^Exit code (\d+)/u.exec(typeof error === "string" ? error : "")?.[1];
  return code === undefined ? undefined : Number(code);
}

const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

/** The line kept of one hook input; null for an event watch does not read. */
export function toRecord(input, config, now = Date.now()) {
  const event = input.hook_event_name;
  const base = {
    time: now,
    event,
    agentId: clip(input.agent_id, 100),
    agentType: clip(input.agent_type, 100),
  };
  const call = () => {
    const tool = clip(input.tool_name, 100);
    const s = summary(input.tool_name, input.tool_input, config.root);
    return { toolUseId: clip(input.tool_use_id, 100), tool, input: drop(s), gate: input.tool_name === "Bash" ? gateOf(input.tool_input?.command, config.gates) : undefined };
  };
  switch (event) {
    case "PreToolUse":
    case "PermissionRequest":
      return drop({ ...base, ...call() });
    case "PostToolUse": {
      // A failed call's response is its error text (fact 26): keep the verdict only.
      if (typeof input.tool_response === "string") return drop({ ...base, ...call(), ok: false, exitCode: exitCodeOf(input.tool_response) });
      const taskId = input.tool_name === "TaskCreate" ? input.tool_response?.task?.id : undefined;
      return drop({ ...base, ...call(), ok: true, taskId: clip(taskId == null ? undefined : String(taskId), 50) });
    }
    case "PostToolUseFailure":
      return drop({ ...base, ...call(), ok: false, interrupted: input.is_interrupt === true || undefined, exitCode: exitCodeOf(input.error) });
    case "PermissionDenied":
      return drop({ ...base, ...call(), reason: clip(input.reason, 200) });
    case "Notification":
      return drop({ ...base, kind: clip(input.notification_type, 50) });
    case "SubagentStart":
    case "SubagentStop":
      return drop(base);
    case "TaskCreated":
      return drop({ ...base, taskId: clip(String(input.task_id ?? ""), 50), subject: clip(input.task_subject, 200) });
    case "SessionStart":
      return drop({ ...base, source: clip(input.source, 20), repo: path.basename(config.root) });
    case "SessionEnd":
      return drop({ ...base, reason: clip(input.reason, 50) });
    case "UserPromptSubmit":
    case "Stop":
      return drop(base);
    default:
      return null;
  }
}

/** Appends one line to the session's file; false when the input names no usable session. */
export function append(input, config, record) {
  const session = safeId(input.session_id);
  if (!session || !record) return false;
  const dir = path.join(watchHome(), repoKey(config.root));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // One write of one line with O_APPEND: concurrent hooks do not interleave.
  const fd = openSync(path.join(dir, `${session}.jsonl`), "a", 0o600);
  try {
    writeSync(fd, `${JSON.stringify(record)}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * Records a docrank guard's refusal, which no hook event reports (harness
 * fact 21). Quiet on any failure: the refusal itself must not depend on it.
 */
export function recordRefusal(input, config, reason, guard) {
  try {
    if (!config?.watch?.enabled || !input) return;
    const { input: summaryOf, tool, toolUseId } = toRecord({ ...input, hook_event_name: "PreToolUse" }, config);
    append(input, config, drop({
      time: Date.now(),
      event: "Refused",
      agentId: clip(input.agent_id, 100),
      toolUseId,
      tool,
      input: summaryOf,
      guard: clip(guard, 50),
      reason: clip(String(reason).split("\n")[0], 300),
    }));
  } catch {}
}
