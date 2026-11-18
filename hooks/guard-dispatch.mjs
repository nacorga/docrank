#!/usr/bin/env node
/**
 * PreToolUse hook on Agent, read from `dispatch.*` in the repository's config.
 *
 * - A fork is refused (`forkBan`): it starts from the session's whole context
 *   and re-reads it on every turn, where a fresh subagent briefed from the
 *   plan starts from the brief.
 * - A named dispatch of an agent defined without SendMessage is refused: a
 *   name makes it a teammate that answers only through SendMessage, so it
 *   would judge and go silent, and a judge's silence reads like approval.
 * - An `Explore` or `general-purpose` dispatch that names no model runs on
 *   `defaultModel` at `defaultEffort`: left unnamed it inherits the session's
 *   model, so what a slice costs depends on what the orchestrator runs on.
 * - With `heavyMarker`, a `general-purpose` dispatch on Opus goes ahead only
 *   with a line `Heavy: <path>` whose file says "heavy": the plan, not the
 *   orchestrator, decides which slice is worth the stronger model.
 * - A dispatch to an agent that can edit is completed with every line of the
 *   guardrails block it lacks: the default block of this plugin's
 *   `dispatch-guardrails` skill, then the repository's `guardrailsFile`. A
 *   paraphrase drops the clause that mattered, and completing the dispatch
 *   costs no turn where a refusal costs one. Whitespace may differ; the text
 *   may not. A read-only type (lib/agent-types.mjs) dispatches without it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PLUGIN_ROOT, isReadOnlyType, lacksSendMessage } from "../lib/agent-types.mjs";
import { configFor, decide, deny, readInput } from "../lib/hook.mjs";

const input = await readInput();
const config = configFor(input);
const { root } = config;
const dispatch = config.dispatch;
const tool = input.tool_input ?? {};
const type = tool.subagent_type ?? "general-purpose";

if (type === "fork" && dispatch.forkBan) {
  deny(
    "A fork re-reads this session's whole context on every turn (docrank `dispatch.forkBan`). Dispatch a fresh `general-purpose` subagent briefed from the plan; a fix round resumes it with SendMessage.",
  );
}

if (tool.name && lacksSendMessage(type, root)) {
  deny(
    `${type} has no SendMessage among its tools, so a named ${type} can never report back. Dispatch it without \`name\`: its final message is then the result.`,
  );
}

const defaulted =
  (type === "general-purpose" || type === "Explore") && !tool.model
    ? { model: dispatch.defaultModel, effort: tool.effort ?? dispatch.defaultEffort }
    : undefined;

if (
  dispatch.heavyMarker &&
  type === "general-purpose" &&
  /opus/iu.test(tool.model ?? "") &&
  !markedHeavy(tool.prompt ?? "")
) {
  deny(
    `A general-purpose dispatch on Opus needs a line \`Heavy: <path>\` naming the plan that marks this slice heavy (docrank \`dispatch.heavyMarker\`). Without one, dispatch it with no model: it runs on ${dispatch.defaultModel}.`,
  );
}

let block;
let missing;
if (!isReadOnlyType(type, root)) {
  block = guardrails();
  const normalize = (text) => text.replace(/\s+/gu, " ").trim();
  const prompt = normalize(tool.prompt ?? "");
  missing = block
    .split("\n")
    .map(normalize)
    .find((line) => line && !prompt.includes(line));
}
if (!missing && !defaulted) process.exit(0);

const reasons = [];
const context = [];
if (missing) {
  reasons.push(`docrank completed the guardrails block (missing: "${missing}").`);
  context.push(
    `docrank added the guardrails block to this ${type} dispatch (missing: "${missing}"). Its final message is its report; if that message does not arrive, \`node ${path.join(PLUGIN_ROOT, "scripts", "last-report.mjs")} <the output file the dispatch names>\` prints the last thing it said.`,
  );
}
if (defaulted) {
  reasons.push(`docrank set this ${type} dispatch to ${defaulted.model} at ${defaulted.effort} effort.`);
  context.push(
    `docrank runs this ${type} dispatch on ${defaulted.model} at ${defaulted.effort} effort, because it named no model (\`dispatch.defaultModel\`).${dispatch.heavyMarker ? ' A slice the plan marks heavy is dispatched with `model: "opus"` and a line `Heavy: <path>` naming that plan.' : ""}`,
  );
}
decide({
  permissionDecision: "allow",
  permissionDecisionReason: reasons.join(" "),
  updatedInput: {
    ...tool,
    ...defaulted,
    prompt: missing ? `${tool.prompt ?? ""}\n\n${block}` : tool.prompt,
  },
  additionalContext: context.join("\n"),
});

/** The plugin's default block, then the repository's own text. */
function guardrails() {
  const skill = readFileSync(path.join(PLUGIN_ROOT, "skills", "dispatch-guardrails", "SKILL.md"), "utf8");
  const own = /## The block\s+```text\n([\s\S]*?)\n```/u.exec(skill)[1];
  if (!dispatch.guardrailsFile) return own;
  try {
    return `${own}\n\n${readFileSync(path.resolve(root, dispatch.guardrailsFile), "utf8").trim()}`;
  } catch {
    return deny(
      `docrank \`dispatch.guardrailsFile\` names ${dispatch.guardrailsFile}, which cannot be read from ${root}: fix the file or the key, then dispatch again.`,
    );
  }
}

/** The prompt's `Heavy: <path>` names a file that says "heavy". */
function markedHeavy(prompt) {
  const marked = /^Heavy:\s*(\S+)\s*$/mu.exec(prompt)?.[1];
  if (!marked) return false;
  try {
    return /heavy/iu.test(readFileSync(path.resolve(root, marked), "utf8"));
  } catch {
    return false;
  }
}
