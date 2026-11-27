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
 *   with a line `Heavy: <path> <slice>` whose file holds a line for that slice
 *   that says "heavy": the plan, not the orchestrator, decides which slice is
 *   worth the stronger model. Matching the word anywhere in the file let one
 *   heavy slice put every other on Opus, hence the slice.
 * - A slice's fix rounds run on the default model: when this session already
 *   dispatched the same slice on Opus, a second Opus dispatch needs the
 *   slice's line to say "heavy fixes". A fix round re-reads a context that
 *   has only grown; the first build is where the stronger model pays. The earlier dispatch is read from the
 *   session's transcript (docs/harness-facts.md, fact 24); one that cannot be
 *   read lets the dispatch through.
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
    "A fork re-reads this session's whole context on every turn (stickler `dispatch.forkBan`). Dispatch a fresh `general-purpose` subagent briefed from the plan; a fix round resumes it with SendMessage.",
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

if (dispatch.heavyMarker && type === "general-purpose" && /opus/iu.test(tool.model ?? "")) {
  const heavy = /^Heavy:[ \t]*(\S+)?(?:[ \t]+(\S.*?))?[ \t]*$/mu.exec(tool.prompt ?? "");
  if (!heavy?.[1] || !heavy[2]) {
    deny(
      `A general-purpose dispatch on Opus needs a line \`Heavy: <path> <slice>\` naming the plan and the slice it marks heavy, as in \`Heavy: docs/plan.md B\` (stickler \`dispatch.heavyMarker\`). Without one, dispatch it with no model: it runs on ${dispatch.defaultModel}.`,
    );
  }
  const line = sliceLine(heavy[1], heavy[2]);
  if (!line || !/heavy/iu.test(line)) {
    deny(
      `${heavy[1]} has no line for slice ${heavy[2]} that says "heavy" (stickler \`dispatch.heavyMarker\`): a slice is a table row whose first cell starts with its id, or a checklist item \`- [ ] **<slice> ·\`. Mark the slice heavy there, or dispatch it with no model: it runs on ${dispatch.defaultModel}.`,
    );
  }
  if (!/heavy fixes/iu.test(line) && builtOnOpus(String(input.transcript_path ?? ""), heavy[1], heavy[2])) {
    deny(
      `Slice ${heavy[2]} already ran on Opus in this session, and its fix rounds run on ${dispatch.defaultModel} (stickler \`dispatch.heavyMarker\`). Dispatch this one with no model, as every fix round; to keep Opus for the fixes, its line in ${heavy[1]} must say "heavy fixes".`,
    );
  }
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
  reasons.push(`stickler completed the guardrails block (missing: "${missing}").`);
  context.push(
    `stickler added the guardrails block to this ${type} dispatch (missing: "${missing}"). Its final message is its report; if that message does not arrive, \`node ${path.join(PLUGIN_ROOT, "scripts", "last-report.mjs")} <the output file the dispatch names>\` prints the last thing it said.`,
  );
}
if (defaulted) {
  reasons.push(`stickler set this ${type} dispatch to ${defaulted.model} at ${defaulted.effort} effort.`);
  context.push(
    `stickler runs this ${type} dispatch on ${defaulted.model} at ${defaulted.effort} effort, because it named no model (\`dispatch.defaultModel\`).${dispatch.heavyMarker ? ' A slice the plan marks heavy is dispatched with `model: "opus"` and a line `Heavy: <path> <slice>` naming that plan and the slice.' : ""}`,
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
      `stickler \`dispatch.guardrailsFile\` names ${dispatch.guardrailsFile}, which cannot be read from ${root}: fix the file or the key, then dispatch again.`,
    );
  }
}

/** The line of `slice` in the plan at `file`: a table row led by its id, or a checklist item `**<slice> ·`. */
function sliceLine(file, slice) {
  let text;
  try {
    text = readFileSync(path.resolve(root, file), "utf8");
  } catch {
    return undefined;
  }
  return text.split("\n").find((line) => {
    const row = /^\s*\|\s*([^|\s]+)/u.exec(line);
    if (row) return row[1].replace(/^[*`]+|[*`]+$/gu, "") === slice;
    return /^\s*[-*]\s+\[[ xX]\]\s+\*\*/u.test(line) && line.replace(/^\s*[-*]\s+\[[ xX]\]\s+/u, "").startsWith(`**${slice} \u00b7`);
  });
}

/**
 * Whether an earlier Agent dispatch in the session's transcript ran this
 * slice on Opus: an assistant `tool_use` record of the Agent (or Task) tool,
 * with `model` opus and the same `Heavy:` line, whose `tool_result` is no
 * error. Fails open.
 */
function builtOnOpus(transcript, file, slice) {
  let text;
  try {
    text = readFileSync(transcript, "utf8");
  } catch {
    return false;
  }
  const same = (prompt) => {
    const found = /^Heavy:[ \t]*(\S+)[ \t]+(\S.*?)[ \t]*$/mu.exec(prompt ?? "");
    return found?.[1] === file && found[2] === slice;
  };
  // A dispatch counts once it ran: a refused one (a hook's deny, the user's
  // no) leaves a tool_result marked as an error, and its retry is the build.
  const dispatched = new Set();
  const ran = new Set();
  for (const record of text.split("\n")) {
    if (!record.includes("tool_")) continue;
    let content;
    try {
      content = JSON.parse(record).message?.content;
    } catch {
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part?.type === "tool_use" &&
        (part.name === "Agent" || part.name === "Task") &&
        /opus/iu.test(part.input?.model ?? "") &&
        same(part.input?.prompt)
      )
        dispatched.add(part.id);
      if (part?.type === "tool_result" && !part.is_error) ran.add(part.tool_use_id);
    }
  }
  return [...dispatched].some((id) => ran.has(id));
}
