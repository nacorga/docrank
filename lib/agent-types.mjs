/**
 * What an agent type is and may do, read from its definition, so the hooks
 * that ask — dispatch, read-only and re-check — share one answer.
 *
 * Claude Code names a custom agent by its frontmatter `name`, and an agent a
 * plugin ships as `<plugin>:<name>` (docs/harness-facts.md, fact 5). A bare
 * type is looked up in the repository's `.claude/agents/`, a type scoped to
 * this plugin in the plugin's own `agents/`. A type defined in neither, or
 * defined without `tools:`, which inherits every tool, can edit.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const builtInReadOnly = new Set(["Explore", "Plan", "claude-code-guide"]);
const editing = ["Edit", "Write", "NotebookEdit"];

const pluginName = (pluginRoot) => {
  try {
    return JSON.parse(readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")).name;
  } catch {
    return undefined;
  }
};

/** The frontmatter of the agent Claude Code calls `type`, or `undefined`. */
function frontOf(type, root, pluginRoot) {
  const scoped = /^([\w-]+):([\w-]+)$/u.exec(type);
  if (!scoped && !/^[\w-]+$/u.test(type)) return undefined;
  if (scoped && scoped[1] !== pluginName(pluginRoot)) return undefined;
  const dir = scoped ? path.join(pluginRoot, "agents") : path.join(root, ".claude", "agents");
  const name = scoped ? scoped[2] : type;
  let files;
  try {
    // Claude Code scans the directory recursively and names an agent by its `name`.
    files = readdirSync(dir, { recursive: true }).filter((file) => file.endsWith(".md"));
  } catch {
    return undefined;
  }
  for (const file of files) {
    const front = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(readFileSync(path.join(dir, file), "utf8"))?.[1];
    if (front !== undefined && field(front, "name")?.[0] === name) return front;
  }
  return undefined;
}

/**
 * A frontmatter field as a list: `key: a, b`, `key: [a, b]` or `- a` lines
 * under `key:`; `undefined` when the field is absent.
 */
function field(front, key) {
  const match = new RegExp(`^${key}:[ \\t]*(.*)$((?:\\n[ \\t]*-.*)*)`, "mu").exec(front);
  if (!match) return undefined;
  const inline = match[1].replace(/^\[|\]$/gu, "");
  const items = match[2] ? match[2].split("\n").map((line) => line.replace(/^\s*-/u, "")) : inline.split(",");
  return items.map((item) => item.trim().replace(/^["']|["']$/gu, "")).filter(Boolean);
}

/** What `type` lists in `tools:` and `disallowedTools:`, when it is defined. */
function toolsOf(type, root, pluginRoot) {
  const front = frontOf(type, root, pluginRoot);
  if (front === undefined) return undefined;
  return { tools: field(front, "tools"), withheld: field(front, "disallowedTools") ?? [] };
}

const has = ({ tools, withheld }, tool) => (tools === undefined || tools.includes(tool)) && !withheld.includes(tool);

export function isReadOnlyType(type, root, pluginRoot = PLUGIN_ROOT) {
  if (builtInReadOnly.has(type)) return true;
  const defined = toolsOf(type, root, pluginRoot);
  return defined !== undefined && !editing.some((tool) => has(defined, tool));
}

/** A judge is an agent that preloads `skill`, bare or scoped to this plugin. */
export function isJudgeType(type, root, skill, pluginRoot = PLUGIN_ROOT) {
  const front = frontOf(type, root, pluginRoot);
  const skills = front === undefined ? [] : (field(front, "skills") ?? []);
  return skills.includes(skill) || skills.includes(`${pluginName(pluginRoot)}:${skill}`);
}

/**
 * Whether the agent defined as `type` cannot use SendMessage. A type defined
 * nowhere here, or one inheriting every tool, is not this question's to answer.
 */
export function lacksSendMessage(type, root, pluginRoot = PLUGIN_ROOT) {
  const defined = toolsOf(type, root, pluginRoot);
  return defined !== undefined && !has(defined, "SendMessage");
}
