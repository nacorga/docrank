import { describe, expect, it } from "vitest";
import { isJudgeType, isReadOnlyType, lacksSendMessage } from "./agent-types.mjs";
import { agent, project } from "./testing.mjs";

const repo = project({
  ".claude/agents/reviewer.md": agent("name: reviewer\ntools: Read, Grep, Bash, SendMessage\nskills:\n  - judge-protocol"),
  ".claude/agents/review/auditor.md": agent("name: auditor\ntools: [Read, Bash]"),
  ".claude/agents/builder.md": agent("name: builder\ntools: Read, Edit, Bash"),
  ".claude/agents/inheritor.md": agent("name: inheritor\ndescription: every tool"),
  ".claude/agents/withheld.md": agent("name: withheld\ndisallowedTools: Edit, Write, NotebookEdit, SendMessage"),
  ".claude/agents/file-name.md": agent("name: by-name\ntools: Read"),
});
const plugin = project({
  ".claude-plugin/plugin.json": JSON.stringify({ name: "stickler" }),
  "agents/judge.md": agent("name: judge\ntools: Read, Bash, SendMessage\nskills: stickler:judge-protocol"),
  "agents/maker.md": agent("name: maker\ntools: Read, Write"),
});

describe("agent-types", () => {
  it("knows the built-in read-only types and leaves general-purpose editing", () => {
    for (const type of ["Explore", "Plan", "claude-code-guide"]) expect(isReadOnlyType(type, repo, plugin), type).toBe(true);
    expect(isReadOnlyType("general-purpose", repo, plugin)).toBe(false);
  });

  it("reads a repository agent by its name, in any subfolder, in any list form", () => {
    expect(isReadOnlyType("reviewer", repo, plugin)).toBe(true);
    expect(isReadOnlyType("auditor", repo, plugin)).toBe(true);
    expect(isReadOnlyType("withheld", repo, plugin)).toBe(true);
    expect(isReadOnlyType("by-name", repo, plugin)).toBe(true);
    expect(isReadOnlyType("file-name", repo, plugin)).toBe(false);
    expect(isReadOnlyType("builder", repo, plugin)).toBe(false);
    expect(isReadOnlyType("inheritor", repo, plugin)).toBe(false);
    expect(isReadOnlyType("absent", repo, plugin)).toBe(false);
    expect(isReadOnlyType("../x", repo, plugin)).toBe(false);
  });

  it("reads a plugin agent only under this plugin's scoped name", () => {
    expect(isReadOnlyType("stickler:judge", repo, plugin)).toBe(true);
    expect(isReadOnlyType("stickler:maker", repo, plugin)).toBe(false);
    expect(isReadOnlyType("judge", repo, plugin)).toBe(false);
    expect(isReadOnlyType("other:judge", repo, plugin)).toBe(false);
    expect(isReadOnlyType("stickler:reviewer", repo, plugin)).toBe(false);
  });

  it("calls a judge an agent preloading the configured skill, bare or scoped", () => {
    expect(isJudgeType("reviewer", repo, "judge-protocol", plugin)).toBe(true);
    expect(isJudgeType("stickler:judge", repo, "judge-protocol", plugin)).toBe(true);
    expect(isJudgeType("reviewer", repo, "review-rules", plugin)).toBe(false);
    for (const type of ["auditor", "builder", "general-purpose", "absent"]) {
      expect(isJudgeType(type, repo, "judge-protocol", plugin), type).toBe(false);
    }
  });

  it("knows which defined agents lack SendMessage, and nothing of the rest", () => {
    expect(lacksSendMessage("auditor", repo, plugin)).toBe(true);
    expect(lacksSendMessage("withheld", repo, plugin)).toBe(true);
    expect(lacksSendMessage("stickler:maker", repo, plugin)).toBe(true);
    for (const type of ["reviewer", "stickler:judge", "inheritor", "general-purpose", "absent"]) {
      expect(lacksSendMessage(type, repo, plugin), type).toBe(false);
    }
  });
});
