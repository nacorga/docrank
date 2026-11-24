import { describe, expect, it } from "vitest";
import { project, runHook } from "../lib/testing.mjs";

const configured = project({ ".claude/stickler.json": JSON.stringify({ plan: { requiredHeadings: ["Double check", "Doble check"] } }) });
const plan = "# Plan\n\n## Context\n\nWhat changes.\n";

/** The deny reason for an ExitPlanMode call, or null. */
async function planDecision(toolInput, where = configured) {
  const output = await runHook("guard-plan.mjs", { tool_name: "ExitPlanMode", tool_input: toolInput }, where);
  if (!output) return null;
  expect(output.permissionDecision).toBe("deny");
  return output.permissionDecisionReason;
}

describe("guard-plan.mjs", () => {
  it("holds a plan to its configured heading", async () => {
    expect(await planDecision({ plan })).toContain("`Double check` or `Doble check`");
  });

  it("lets a plan with the heading through, at any level and in either spelling", async () => {
    expect(await planDecision({ plan: `${plan}\n## Double check\n\nNothing left out.\n` })).toBeNull();
    expect(await planDecision({ plan: `${plan}\n### doble check\n` })).toBeNull();
  });

  it("does not take the words in a sentence, or a longer word, for the heading", async () => {
    expect(await planDecision({ plan: `${plan}\nA double check follows.\n## Double checkpoint\n` })).not.toBeNull();
  });

  it("reads a plan from the file it names", async () => {
    const files = project({ "ok.md": `${plan}\n## Double check\n`, "bad.md": plan });
    expect(await planDecision({ planFilePath: `${files}/ok.md` })).toBeNull();
    expect(await planDecision({ planFilePath: `${files}/bad.md` })).not.toBeNull();
  });

  it("stays out of the way when it cannot read a plan", async () => {
    expect(await planDecision({})).toBeNull();
    expect(await planDecision({ planFilePath: "/nonexistent/plan.md" })).toBeNull();
  });

  it("is off when plan.requiredHeadings is empty", async () => {
    expect(await planDecision({ plan }, project())).toBeNull();
  });
});
