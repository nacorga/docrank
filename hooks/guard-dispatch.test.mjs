import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_ROOT, builtInReadOnly } from "../lib/agent-types.mjs";
import { agent, project, runHook } from "../lib/testing.mjs";

// The cases are TraceLog's guard-dispatch suite, on neutral names, plus what
// the config now decides.
const agents = {
  ".claude/agents/reviewer.md": agent("name: reviewer\ntools: Read, Grep, Bash, SendMessage\nskills:\n  - judge-protocol"),
  ".claude/agents/mute.md": agent("name: mute\ntools: Read, Grep\n---\n\nSendMessage is named here, outside the tools."),
  ".claude/agents/builder.md": agent("name: builder\ntools: Read, Edit, Bash"),
  ".claude/agents/inheritor.md": agent("name: inheritor"),
};
const dir = project({
  ...agents,
  "docs/plan.md": "- [ ] Slice B (heavy): the detector.\n",
  "docs/light.md": "- [ ] Slice A: the copy.\n",
});

/** The block as the skill holds it; the suite never keeps a copy. */
const block = /## The block\s+```text\n([\s\S]*?)\n```/u.exec(
  readFileSync(path.join(PLUGIN_ROOT, "skills", "dispatch-guardrails", "SKILL.md"), "utf8"),
)?.[1];
const task = "Translate the settings page.";
const dispatched = (text) => `${task}\n\n${text}`;
/** A dispatch that names its model, so only the block is in question. */
const named = { model: "sonnet" };

const dispatch = (toolInput, where = dir) =>
  runHook("guard-dispatch.mjs", { tool_name: "Agent", tool_input: { description: "probe", ...toolInput } }, where);

/** What the hook did to a dispatch: the input it set and what it said, or null. */
async function dispatchDecision(prompt, subagentType, chosen = {}, where = dir) {
  const output = await dispatch(
    { prompt, ...(subagentType === undefined ? {} : { subagent_type: subagentType }), ...chosen },
    where,
  );
  if (!output) return null;
  expect(output.permissionDecision).toBe("allow");
  return { ...output.updatedInput, context: output.additionalContext };
}

describe("guard-dispatch.mjs", () => {
  it("holds the block where the hook reads it", () => {
    expect(block).toBeDefined();
    expect(block).not.toMatch(/tracelog|pnpm|develop\b/iu);
  });

  it("builds a general-purpose dispatch on the default model and effort unless it names a model", async () => {
    const whole = dispatched(block);
    for (const type of [undefined, "general-purpose"]) {
      const set = await dispatchDecision(whole, type);
      expect(set, String(type)).not.toBeNull();
      expect(set.model).toBe("sonnet");
      expect(set.effort).toBe("medium");
      expect(set.prompt).toBe(whole);
      expect(set.context).toContain('model: "opus"');
    }
    expect((await dispatchDecision(whole, undefined, { effort: "high" })).effort).toBe("high");
    expect(await dispatchDecision(whole, undefined, named)).toBeNull();
    expect(await dispatchDecision(whole, "general-purpose", { model: "sonnet" })).toBeNull();
    expect(await dispatchDecision(whole, "claude")).toBeNull();
  });

  it("takes the default model and effort from the config", async () => {
    const configured = project({
      ".claude/docrank.json": JSON.stringify({
        dispatch: { defaultModel: "haiku", defaultEffort: "low", heavyMarker: false },
      }),
    });
    const set = await dispatchDecision(dispatched(block), undefined, {}, configured);
    expect(set).toMatchObject({ model: "haiku", effort: "low" });
    expect(set.context).not.toContain("Heavy:");
    expect(await dispatchDecision(dispatched(block), undefined, { model: "opus" }, configured)).toBeNull();
  });

  it("completes a dispatch that can edit with the block, whatever the session", async () => {
    for (const type of [undefined, "general-purpose", "claude", "builder", "inheritor"]) {
      const completed = await dispatchDecision(task, type);
      expect(completed, String(type)).not.toBeNull();
      expect(completed.prompt).toBe(dispatched(block));
      expect(completed.context).toContain(path.join(PLUGIN_ROOT, "scripts", "last-report.mjs"));
      expect(await dispatchDecision(completed.prompt, type, named)).toBeNull();
    }
  });

  it("lets the block through verbatim, however it is wrapped", async () => {
    expect(await dispatchDecision(dispatched(block), undefined, named)).toBeNull();
    expect(await dispatchDecision(dispatched(block.replace(/\s+/gu, " ")), undefined, named)).toBeNull();
  });

  it("names the clause a paraphrase drops", async () => {
    const clause = block.split("\n").find((line) => line.includes("Never modify shared configuration"));
    expect(clause).toBeDefined();
    const completed = await dispatchDecision(dispatched(block.replace(clause, "")), undefined, named);
    expect(completed.context).toContain(clause.replace(/\s+/gu, " ").trim());
    expect(await dispatchDecision(completed.prompt, undefined, named)).toBeNull();
  });

  it("appends the repository's own guardrails after the default block", async () => {
    const extended = project({
      ".claude/docrank.json": JSON.stringify({ dispatch: { guardrailsFile: "docs/guardrails.md" } }),
      "docs/guardrails.md": "- **Never run the migrations.** They hold production.\n",
    });
    const whole = `${block}\n\n- **Never run the migrations.** They hold production.`;
    const completed = await dispatchDecision(dispatched(block), undefined, named, extended);
    expect(completed.prompt).toBe(`${dispatched(block)}\n\n${whole}`);
    expect(await dispatchDecision(dispatched(whole), undefined, named, extended)).toBeNull();

    const missing = project({
      ".claude/docrank.json": JSON.stringify({ dispatch: { guardrailsFile: "docs/absent.md" } }),
    });
    const refused = await dispatch({ prompt: task }, missing);
    expect(refused.permissionDecision).toBe("deny");
    expect(refused.permissionDecisionReason).toContain("docs/absent.md");
  });

  it("asks for the report as the final message, never as a file", () => {
    expect(block).toContain("Your final message is your report");
    expect(block).toContain("Write no report file");
  });

  it("lets a read-only type dispatch without it, and runs Explore on the default model", async () => {
    for (const type of builtInReadOnly) {
      if (type === "Explore") continue;
      expect(await dispatchDecision(task, type), type).toBeNull();
    }
    expect(await dispatchDecision(task, "reviewer")).toBeNull();
    const explore = await dispatchDecision(task, "Explore");
    expect(explore).toMatchObject({ model: "sonnet", effort: "medium", prompt: task });
    expect(await dispatchDecision(task, "Explore", { model: "haiku" })).toBeNull();
  });

  it("dispatches without the guardrails block exactly when the agent cannot edit", async () => {
    for (const [file, canEdit] of [
      ["reviewer", false],
      ["mute", false],
      ["builder", true],
      ["inheritor", true],
    ]) {
      expect((await dispatchDecision("Review the diff.", file, named)) !== null, file).toBe(canEdit);
    }
  });

  it("builds on Opus only when the dispatch names the file that marks it heavy", async () => {
    const whole = dispatched(block);
    const decide = async (prompt) => (await dispatch({ prompt, model: "opus" }))?.permissionDecision ?? null;
    expect(await decide(whole)).toBe("deny");
    expect(await decide(`Heavy: docs/light.md\n${whole}`)).toBe("deny");
    expect(await decide(`Heavy: docs/absent.md\n${whole}`)).toBe("deny");
    expect(await decide(`Heavy: docs/plan.md\n${whole}`)).toBeNull();
    expect(await decide(`Heavy: ${path.join(dir, "docs/plan.md")}\n${whole}`)).toBeNull();
  });

  it("refuses a name for an agent defined without SendMessage", async () => {
    expect((await dispatch({ prompt: task, subagent_type: "mute", name: "judge" })).permissionDecision).toBe("deny");
    expect(await dispatch({ prompt: task, subagent_type: "mute" })).toBeNull();
    expect(await dispatch({ prompt: task, subagent_type: "reviewer", name: "judge" })).toBeNull();
  });

  it("refuses a fork, named or not, block or no block, unless the config allows it", async () => {
    for (const toolInput of [
      { subagent_type: "fork", prompt: task },
      { subagent_type: "fork", prompt: dispatched(block), name: "slice" },
    ]) {
      const output = await dispatch(toolInput);
      expect(output.permissionDecision).toBe("deny");
      expect(output.permissionDecisionReason).toContain("general-purpose");
    }
    const allowed = project({ ".claude/docrank.json": JSON.stringify({ dispatch: { forkBan: false } }) });
    expect(await dispatchDecision(dispatched(block), "fork", {}, allowed)).toBeNull();
  });

  it("refuses every dispatch while the config does not validate, naming the key", async () => {
    const broken = project({ ".claude/docrank.json": JSON.stringify({ dispatch: { forkBan: "yes" } }) });
    const output = await dispatch({ prompt: task }, broken);
    expect(output.permissionDecision).toBe("deny");
    expect(output.permissionDecisionReason).toContain("dispatch.forkBan");
  });
});
