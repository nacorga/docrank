import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { project, runHook } from "../lib/testing.mjs";

const checklist = "Prove each claim.";
const dir = project({ ".claude/stickler.json": JSON.stringify({ messages: { tools: ["^mcp__mail__(send|reply)$"], checklist } }) });
const sessions = [];

afterEach(() => {
  for (const session of sessions.splice(0)) rmSync(path.join(tmpdir(), `stickler-message-${session}`), { force: true });
});

/** The deny reason for a call, or null. */
async function messageDecision(session, tool, toolInput, where = dir, transcript_path = undefined) {
  const output = await runHook("guard-message.mjs", { session_id: session, tool_name: tool, tool_input: toolInput, transcript_path }, where);
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

  describe("with messages.evidenceHeader", () => {
    const evidenceDir = project({
      ".claude/stickler.json": JSON.stringify({
        messages: { tools: ["^mcp__mail__(send|reply)$"], checklist, evidenceHeader: "^\\|\\s*(Claim|Afirmaci)" },
      }),
    });
    const TABLE = "Claims:\n\n| Claim | Source | Result |\n|---|---|---|\n| 403 visits | query | 403 |";
    const prompt = (text) => ({ type: "user", message: { role: "user", content: text } });
    const said = (text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
    const toolCall = { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "mcp__mail__send", input: {} }] } };
    const toolResult = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } };
    const call = (id, name, toolInput, extra = {}) => ({ type: "assistant", ...extra, message: { role: "assistant", content: [{ type: "tool_use", id, name, input: toolInput }] } });
    const result = (id, extra = {}) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok", ...extra }] } });
    const wrote = (id, text) => [call(id, "Write", { file_path: "/tmp/evidence.md", content: text }), result(id)];
    const transcript = (entries, raw = null) => {
      const file = path.join(mkdtempSync(path.join(tmpdir(), "stickler-transcript-")), "t.jsonl");
      writeFileSync(file, raw ?? entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
      return file;
    };
    const send = (session, entries, extra = {}) =>
      messageDecision(session, "mcp__mail__send", { body: "x", ...extra }, evidenceDir, entries);

    it("passes at the first attempt when the turn wrote the table, whatever the call", async () => {
      const file = transcript([prompt("write to them"), said("Draft."), said(TABLE), toolCall, toolResult]);
      const session = fresh();
      expect(await send(session, file)).toBeNull();
      expect(await messageDecision(session, "mcp__mail__send", { body: "another" }, evidenceDir, file)).toBeNull();
    });

    it("refuses every attempt, naming what is missing, when the table was written before the last prompt", async () => {
      const file = transcript([prompt("first"), said(TABLE), ...wrote("w0", TABLE), prompt("send it"), said("Sending.")]);
      const session = fresh();
      const reason = await send(session, file);
      expect(reason).toContain(checklist);
      expect(reason).toContain("Missing: a Markdown table");
      expect(reason).toContain("Write it with a tool");
      expect(await send(session, file)).toContain("Missing: a Markdown table");
    });

    it("refuses the identical resend too when the transcript holds no table, and passes once one is written", async () => {
      const none = transcript([prompt("send it"), said("Sending.")]);
      const session = fresh();
      expect(await send(session, none)).toContain("Missing: a Markdown table");
      expect(await send(session, none)).toContain("Missing: a Markdown table");
      const withTable = transcript([prompt("send it"), said("Sending."), ...wrote("w1", TABLE)]);
      expect(await send(session, withTable)).toBeNull();
    });

    it("takes the table from the input of an earlier call that ran: a Write, an Edit, a Bash heredoc", async () => {
      expect(await send(fresh(), transcript([prompt("write to them"), ...wrote("w1", TABLE)]))).toBeNull();
      const edit = [call("e1", "Edit", { file_path: "/tmp/e.md", old_string: "", new_string: TABLE }), result("e1")];
      expect(await send(fresh(), transcript([prompt("go"), ...edit]))).toBeNull();
      const heredoc = [call("b1", "Bash", { command: `cat > /tmp/e.md <<'EOF'\n${TABLE}\nEOF` }), result("b1")];
      expect(await send(fresh(), transcript([prompt("go"), ...heredoc]))).toBeNull();
    });

    it("does not take the input of a call that was refused, has no result yet, ran before the last prompt or ran in a subagent", async () => {
      const refused = [call("r1", "mcp__mail__send", { body: TABLE }), result("r1", { is_error: true })];
      expect(await send(fresh(), transcript([prompt("go"), ...refused]))).toContain("Missing");
      expect(await send(fresh(), transcript([prompt("go"), call("p1", "Write", { content: TABLE })]))).toContain("Missing");
      expect(await send(fresh(), transcript([prompt("first"), ...wrote("o1", TABLE), prompt("send it")]))).toContain("Missing");
      const sidechain = [call("s1", "Write", { content: TABLE }, { isSidechain: true }), { ...result("s1"), isSidechain: true }];
      expect(await send(fresh(), transcript([prompt("go"), ...sidechain]))).toContain("Missing");
    });

    it("does not take a search for the header for the table", async () => {
      const grep = [call("g1", "Bash", { command: "grep -c '| Claim | Source | Result |' t.jsonl" }), result("g1")];
      expect(await send(fresh(), transcript([prompt("go"), ...grep]))).toContain("Missing");
    });

    it("matches a header written decomposed (NFD) against a pattern written composed", async () => {
      const nfd = "| AFIRMACIÓN | x |\n|---|---|".normalize("NFD");
      expect(nfd).not.toBe(nfd.normalize("NFC"));
      expect(await send(fresh(), transcript([prompt("go"), ...wrote("n1", nfd)]))).toBeNull();
    });

    it("does not take a tool_result for a prompt", async () => {
      const file = transcript([prompt("write to them"), said(TABLE), toolCall, toolResult, said("Sending."), toolCall, toolResult]);
      expect(await send(fresh(), file)).toBeNull();
    });

    it("takes a task notification or a meta peer message for no prompt, a human prompt or an entry with no origin for one", async () => {
      const entry = (extra) => ({ ...prompt("text"), ...extra });
      const base = [prompt("write to them"), said(TABLE)];
      const notification = entry({ origin: { kind: "task-notification" } });
      const peer = entry({ isMeta: true, origin: { kind: "peer" } });
      const handBack = entry({ isMeta: true });
      expect(await send(fresh(), transcript([...base, notification, said("Done.")]))).toBeNull();
      expect(await send(fresh(), transcript([...base, peer]))).toBeNull();
      expect(await send(fresh(), transcript([...base, handBack]))).toBeNull();
      expect(await send(fresh(), transcript([...base, entry({ origin: { kind: "human" } })]))).toContain("Missing");
      expect(await send(fresh(), transcript([...base, entry({ isCompactSummary: true })]))).toContain("Missing");
      expect(await send(fresh(), transcript([...base, prompt("older version, no origin")]))).toContain("Missing");
    });

    it("needs a header matching the key and a table, not a line that starts the same", async () => {
      const wrong = transcript([prompt("go"), said("| Notes | x |\n|---|---|")]);
      expect(await send(fresh(), wrong)).toContain("Missing");
      const noTable = transcript([prompt("go"), said("| Claim: none, I have no table")]);
      expect(await send(fresh(), noTable)).toContain("Missing");
      expect(await send(fresh(), transcript([prompt("go"), said("| AFIRMACIÓN | x |\n| :--- | ---: |")]))).toBeNull();
    });

    it("falls back to refusing once when there is no transcript, it cannot be read or it is not JSONL", async () => {
      for (const file of [undefined, "/nonexistent/t.jsonl", transcript([], "not json\n"), transcript([said("no prompt, no table")])]) {
        const session = fresh();
        expect(await send(session, file)).toBe(checklist);
        expect(await send(session, file)).toBeNull();
      }
    });

    it("reads a long transcript from its tail, and the whole of it when the tail holds no prompt", async () => {
      const filler = said("x".repeat(2000));
      const long = Array.from({ length: 600 }, () => filler);
      expect(await send(fresh(), transcript([prompt("go"), said(TABLE), prompt("send it"), ...long, said("no table here")]))).toContain("Missing");
      expect(await send(fresh(), transcript([prompt("go"), ...long, said(TABLE)]))).toBeNull();
      expect(await send(fresh(), transcript([prompt("go"), said(TABLE), ...long]))).toBeNull();
      expect(await send(fresh(), transcript([prompt("go"), ...wrote("l1", TABLE), ...long]))).toBeNull();
    });

    it("keeps today's refusal once when the key is empty", async () => {
      const file = transcript([prompt("go"), said(TABLE)]);
      const session = fresh();
      expect(await messageDecision(session, "mcp__mail__send", { body: "x" }, dir, file)).toBe(checklist);
      expect(await messageDecision(session, "mcp__mail__send", { body: "x" }, dir, file)).toBeNull();
    });
  });
});
