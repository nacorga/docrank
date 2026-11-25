import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  ".claude/agents/scout.md": agent("name: scout\ntools: Read, Grep, SendMessage"),
};
const dir = project(agents);
const sessions = [];

afterEach(() => {
  for (const session of sessions.splice(0)) rmSync(path.join(tmpdir(), `stickler-recheck-${session}`), { force: true });
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
    const configured = project({ ...agents, ".claude/stickler.json": JSON.stringify({ judges: { maxRechecks: 1 } }) });
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

  describe("an agent that can edit and has compacted", () => {
    const COMPACT = '{"type":"system","subtype":"compact_boundary","content":"Conversation compacted"}\n';
    const roots = [];
    afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));

    /** A session transcript path whose `subagents/agent-<id>.jsonl` holds `lines`, when given. */
    function transcriptWith(id, lines) {
      const root = project();
      roots.push(root);
      const transcript = path.join(root, "session-1.jsonl");
      writeFileSync(transcript, "{}\n");
      if (lines !== undefined) {
        mkdirSync(path.join(root, "session-1", "subagents"), { recursive: true });
        writeFileSync(path.join(root, "session-1", "subagents", `agent-${id}.jsonl`), lines);
      }
      return transcript;
    }
    const ask = (probe, to, message, transcript) => recheckDecision(probe, to, message, { transcript_path: transcript });

    it("is refused once, with the fresh dispatch that replaces it, and the same message then goes through", async () => {
      const probe = await sessionWith([["b1", "general-purpose"]]);
      const transcript = transcriptWith("b1", `{"type":"user"}\n${COMPACT}{"type":"assistant"}\n`);
      const refusal = await ask(probe, "b1", "fix the line", transcript);
      expect(refusal).toContain("b1 (general-purpose) has compacted");
      expect(refusal).toContain("Dispatch a fresh general-purpose agent");
      expect(refusal).toContain("send this message again unchanged");
      expect(refusal).toContain("with no model");
      expect(refusal).toContain("heavy fixes");
      expect(await ask(probe, "b1", "fix the line", transcript)).toBeNull();
      expect(await ask(probe, "b1", "another round", transcript)).toContain("has compacted");
    });

    it("is found by the name it was dispatched under", async () => {
      const probe = await sessionWith([["b2", "general-purpose", "slice-a"]]);
      const transcript = transcriptWith("b2", COMPACT);
      expect(await ask(probe, "slice-a", "round 1", transcript)).toContain("has compacted");
    });

    it("is not held while its transcript shows no compaction", async () => {
      const probe = await sessionWith([["b1", "general-purpose"]]);
      const transcript = transcriptWith("b1", '{"type":"user"}\n{"type":"assistant"}\n');
      for (const round of [1, 2, 3, 4, 5]) expect(await ask(probe, "b1", `round ${round}`, transcript)).toBeNull();
    });

    it("is not held for the words of a record it read, only for the record itself", async () => {
      const probe = await sessionWith([["b1", "general-purpose"]]);
      const quoted = JSON.stringify({ type: "user", content: COMPACT.trim() }) + "\n";
      expect(await ask(probe, "b1", "round 1", transcriptWith("b1", quoted))).toBeNull();
    });

    it("is found when the record straddles the pieces the transcript is read in", async () => {
      const probe = await sessionWith([["b1", "general-purpose"]]);
      const padding = "x".repeat((1 << 20) - 12);
      const transcript = transcriptWith("b1", `${padding}${COMPACT}`);
      expect(await ask(probe, "b1", "round 1", transcript)).toContain("has compacted");
    });

    it("is not held when the transcript is absent, unreadable or not named", async () => {
      const probe = await sessionWith([["b1", "general-purpose"]]);
      expect(await ask(probe, "b1", "round 1", transcriptWith("b1"))).toBeNull();
      expect(await ask(probe, "b1", "round 2", path.join(tmpdir(), "no-such-session.jsonl"))).toBeNull();
      expect(await recheckDecision(probe, "b1", "round 3")).toBeNull();
    });

    it("leaves an agent that cannot edit alone, and a judge to its own count", async () => {
      const probe = await sessionWith([["s1", "scout"], ["a1", "reviewer"]]);
      expect(await ask(probe, "s1", "round 1", transcriptWith("s1", COMPACT))).toBeNull();
      const transcript = transcriptWith("a1", COMPACT);
      for (const round of [1, 2, 3]) expect(await ask(probe, "a1", `round ${round}`, transcript)).toBeNull();
      expect(await ask(probe, "a1", "round 4", transcript)).toContain("no further re-check");
    });
  });

  it("states the limit only as the configured one in the protocol", () => {
    const protocol = readFileSync(path.join(PLUGIN_ROOT, "skills", "judge-protocol", "SKILL.md"), "utf8");
    expect(protocol).toContain("\n## The judge\n");
    expect(protocol).toContain("\n## The caller\n");
    expect(protocol).toContain("The configured limit of re-checks");
    expect(protocol).not.toMatch(/\b(one|two|three|four|five|\d+) re-checks?\b/iu);
  });
});
