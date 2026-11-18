import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { project, runHook } from "../lib/testing.mjs";

const checklist = "Prove each claim.";
const dir = project({ ".claude/docrank.json": JSON.stringify({ messages: { tools: ["^mcp__mail__(send|reply)$"], checklist } }) });
const sessions = [];

afterEach(() => {
  for (const session of sessions.splice(0)) rmSync(path.join(tmpdir(), `docrank-message-${session}`), { force: true });
});

/** The deny reason for a call, or null. */
async function messageDecision(session, tool, toolInput, where = dir) {
  const output = await runHook("guard-message.mjs", { session_id: session, tool_name: tool, tool_input: toolInput }, where);
  if (!output) return null;
  expect(output.permissionDecision).toBe("deny");
  return output.permissionDecisionReason;
}

const fresh = () => {
  const session = `probe-${randomUUID()}`;
  sessions.push(session);
  return session;
};

describe("guard-message.mjs", () => {
  it("refuses a message once with the checklist, and again when it changes", async () => {
    const session = fresh();
    const draft = { to: "a@example.com", body: "403 visits." };
    expect(await messageDecision(session, "mcp__mail__send", draft)).toBe(checklist);
    expect(await messageDecision(session, "mcp__mail__send", draft)).toBeNull();
    expect(await messageDecision(session, "mcp__mail__send", { ...draft, body: "404 visits." })).toBe(checklist);
  });

  it("keeps each session apart", async () => {
    const draft = { body: "x" };
    expect(await messageDecision(fresh(), "mcp__mail__reply", draft)).toBe(checklist);
    expect(await messageDecision(fresh(), "mcp__mail__reply", draft)).toBe(checklist);
  });

  it("leaves a tool messages.tools does not name alone", async () => {
    const session = fresh();
    expect(await messageDecision(session, "mcp__mail__search", { q: "x" })).toBeNull();
    expect(await messageDecision(session, "mcp__other__mail__send", { q: "x" })).toBeNull();
  });

  it("is off when messages.tools is empty", async () => {
    expect(await messageDecision(fresh(), "mcp__mail__send", { body: "x" }, project())).toBeNull();
  });
});
