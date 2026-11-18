import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { project, runJson } from "../lib/testing.mjs";

// The hook keeps its state under the home directory; the tests give it their own.
process.env.HOME = mkdtempSync(path.join(tmpdir(), "docrank-home-"));

let counter = 0;
const turn = (tokens, extra = {}) =>
  JSON.stringify({ type: "assistant", message: { usage: { input_tokens: tokens, cache_read_input_tokens: 0 } }, ...extra });

/** A session; each call is a stop whose transcript ends on the next size, a sidechain turn after it. */
function session(config, ...sizes) {
  const dir = project(config ? { ".claude/docrank.json": JSON.stringify(config) } : {});
  const id = `s-${process.pid}-${counter++}`;
  const transcript = path.join(dir, "t.jsonl");
  return (extra = {}) => {
    writeFileSync(transcript, `${turn(sizes.shift())}\n${turn(1, { isSidechain: true })}\n`);
    return runJson("context-handoff.mjs", { session_id: id, transcript_path: transcript, ...extra }, dir);
  };
}

describe("context-handoff.mjs", () => {
  it("is silent below the threshold", async () => {
    expect(await session(null, 1000)()).toBeNull();
  });

  it("asks once past the threshold, for the plan's hand-off by default", async () => {
    const stop = session(null, 300000, 310000);
    const out = await stop();
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("300k tokens");
    expect(out.reason).toContain("§ Handoff section of the plan");
    expect(await stop()).toBeNull();
  });

  it("re-arms after a compaction", async () => {
    const stop = session(null, 300000, 20000, 300000);
    await stop();
    expect(await stop()).toBeNull();
    expect((await stop()).decision).toBe("block");
  });

  it("reads the threshold and the location from the config", async () => {
    const stop = session({ handoff: { tokenThreshold: 500, location: "docs/state.md" } }, 600);
    expect((await stop()).reason).toContain("into docs/state.md.");
    expect(await session({ handoff: { tokenThreshold: 500 } }, 400)()).toBeNull();
  });

  it("is silent when disabled, on the hook's own stop, and without a transcript", async () => {
    expect(await session({ handoff: { enabled: false } }, 300000)()).toBeNull();
    expect(await session(null, 300000)({ stop_hook_active: true })).toBeNull();
    expect(await session(null, 300000)({ transcript_path: "/nonexistent" })).toBeNull();
  });
});
