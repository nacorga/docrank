import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PLUGIN_ROOT } from "../lib/agent-types.mjs";
import { agent, project, runHook } from "../lib/testing.mjs";

// The cases are TraceLog's guard-recheck suite, on neutral names. The type of
// each agent comes from its dispatch, recorded by the same hook on PostToolUse.
const agents = {
  ".claude/agents/reviewer.md": agent("name: reviewer\ntools: Read, Bash, SendMessage\nskills:\n  - judge-protocol"),
  ".claude/agents/other-reviewer.md": agent("name: other-reviewer\ntools: Read, SendMessage\nskills: [judge-protocol]"),
};
const dir = project(agents);
const sessions = [];

afterEach(() => {
  for (const session of sessions.splice(0)) rmSync(path.join(tmpdir(), `docrank-recheck-${session}`), { force: true });
});

/** A session in which each `id` was dispatched as `type`, optionally with a name. */
async function sessionWith(dispatches, where = dir) {
  const session = `probe-${randomUUID()}`;
  sessions.push(session);
  for (const [id, type, name] of dispatches) {
    await runHook(
      "guard-recheck.mjs",
      {
        session_id: session,
        hook_event_name: "PostToolUse",
        tool_name: "Agent",
        tool_input: { prompt: "Judge.", subagent_type: type, ...(name ? { name } : {}) },
        tool_response: { status: "completed", agentId: id },
      },
      where,
    );
  }
  return { session, where };
}

/** What the hook answers a SendMessage: its deny reason, or null. */
async function recheckDecision(probe, to, message, extra = {}) {
  const output = await runHook(
    "guard-recheck.mjs",
    { session_id: probe.session, hook_event_name: "PreToolUse", tool_name: "SendMessage", tool_input: { to, message }, ...extra },
    probe.where,
  );
  if (!output) return null;
  expect(output.permissionDecision).toBe("deny");
  return output.permissionDecisionReason;
}

describe("guard-recheck.mjs", () => {
  it("passes three re-checks of a judge and refuses the fourth", async () => {
    const probe = await sessionWith([["a1", "reviewer"]]);
    for (const round of [1, 2, 3]) expect(await recheckDecision(probe, "a1", `round ${round}`)).toBeNull();
    expect(await recheckDecision(probe, "a1", "round 4")).toContain("no further re-check");
  });

  it("reads the limit from judges.maxRechecks", async () => {
    const configured = project({ ...agents, ".claude/docrank.json": JSON.stringify({ judges: { maxRechecks: 1 } }) });
    const probe = await sessionWith([["a1", "reviewer"]], configured);
    expect(await recheckDecision(probe, "a1", "round 1")).toBeNull();
    expect(await recheckDecision(probe, "a1", "round 2")).toContain("has had 1 messages");
  });

  it("lets the same refused message through, and refuses a changed one", async () => {
    const probe = await sessionWith([["a1", "other-reviewer"]]);
    for (const round of [1, 2, 3]) await recheckDecision(probe, "a1", `round ${round}`);
    expect(await recheckDecision(probe, "a1", "a question")).not.toBeNull();
    expect(await recheckDecision(probe, "a1", "a question")).toBeNull();
    expect(await recheckDecision(probe, "a1", "round 5")).not.toBeNull();
  });

  it("counts messages, and says so, when one of them was no re-check", async () => {
    const probe = await sessionWith([["a1", "reviewer"]]);
    await recheckDecision(probe, "a1", "this first pass missed a route");
    await recheckDecision(probe, "a1", "round 1");
    await recheckDecision(probe, "a1", "round 2");
    const refusal = await recheckDecision(probe, "a1", "round 3");
    expect(refusal).toContain("has had 3 messages");
    expect(refusal).toContain("fewer than 3 of those were");
    expect(await recheckDecision(probe, "a1", "round 3")).toBeNull();
  });

  it("counts each judge apart", async () => {
    const probe = await sessionWith([
      ["a1", "reviewer"],
      ["a2", "reviewer"],
    ]);
    for (const round of [1, 2, 3]) await recheckDecision(probe, "a1", `round ${round}`);
    expect(await recheckDecision(probe, "a2", "round 1")).toBeNull();
  });

  it("counts a judge reached by its name and by its ID as one", async () => {
    const probe = await sessionWith([["a1", "reviewer", "judge"]]);
    await recheckDecision(probe, "judge", "round 1");
    await recheckDecision(probe, "a1", "round 2");
    await recheckDecision(probe, "judge", "round 3");
    expect(await recheckDecision(probe, "a1", "round 4")).not.toBeNull();
  });

  it("leaves a builder and an agent it cannot place alone", async () => {
    const probe = await sessionWith([["b1", "general-purpose"]]);
    for (const round of [1, 2, 3, 4, 5]) {
      expect(await recheckDecision(probe, "b1", `round ${round}`)).toBeNull();
      expect(await recheckDecision(probe, "slice-a", `round ${round}`)).toBeNull();
    }
  });

  it("never takes the recipient's type from the sender's agent_type", async () => {
    const probe = await sessionWith([]);
    for (const round of [1, 2, 3, 4, 5]) {
      expect(await recheckDecision(probe, "unrecorded", `round ${round}`, { agent_type: "reviewer" })).toBeNull();
    }
  });

  it("states the limit only as the configured one in the protocol", () => {
    const protocol = readFileSync(path.join(PLUGIN_ROOT, "skills", "judge-protocol", "SKILL.md"), "utf8");
    expect(protocol).toContain("\n## The judge\n");
    expect(protocol).toContain("\n## The caller\n");
    expect(protocol).toContain("The configured limit of re-checks");
    expect(protocol).not.toMatch(/\b(one|two|three|four|five|\d+) re-checks?\b/iu);
  });
});
