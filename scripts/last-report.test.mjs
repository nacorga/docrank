import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { PLUGIN_ROOT } from "../lib/agent-types.mjs";
import { project } from "../lib/testing.mjs";

const run = promisify(execFile);
const script = path.join(PLUGIN_ROOT, "scripts", "last-report.mjs");
const said = (content) => JSON.stringify({ type: "assistant", message: { content } });
const tool = (name, message) => ({ type: "tool_use", name, input: { to: "main", message } });

describe("last-report.mjs", () => {
  it("reads a lost report back from the transcript, however it was delivered", async () => {
    for (const [last, expected] of [
      [{ type: "text", text: "Done: the text." }, "Done: the text."],
      [tool("SubagentHandback", "Done: handed back."), "Done: handed back."],
      [tool("SendMessage", "Done: sent."), "Done: sent."],
    ]) {
      const dir = project({
        "agent.jsonl": [
          JSON.stringify({ type: "user", message: { content: "Brief." } }),
          said([{ type: "text", text: "Starting." }]),
          said([last, { type: "tool_use", name: "Bash", input: {} }]),
          '{"type": "assistant", "message": {"content": [{"type": "text", "text": "half a li',
        ].join("\n"),
      });
      const { stdout } = await run(process.execPath, [script, path.join(dir, "agent.jsonl")]);
      expect(stdout.trim(), last.type).toBe(expected);
    }
  });

  it("fails when the agent said nothing, and on a wrong call", async () => {
    const dir = project({ "silent.jsonl": said([]) });
    await expect(run(process.execPath, [script, path.join(dir, "silent.jsonl")])).rejects.toMatchObject({ code: 1 });
    await expect(run(process.execPath, [script])).rejects.toMatchObject({ code: 2 });
    await expect(run(process.execPath, [script, path.join(dir, "absent.jsonl")])).rejects.toMatchObject({ code: 2 });
  });
});
