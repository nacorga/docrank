import { symlinkSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { project, runExit } from "../lib/testing.mjs";

const config = (context) => JSON.stringify({ prompts: { context } });

/** The hook's exit status and the context it added, or null when silent. */
async function prompt(files, text) {
  const { status, stdout } = await runExit("prompt-context.mjs", { prompt: text }, project(files));
  return { status, context: stdout.trim() ? JSON.parse(stdout).hookSpecificOutput : null };
}

const protocol = {
  ".claude/stickler.json": config([{ match: "^\\s*/?(?:ideas|brainstorm)\\b", file: ".claude/ideas.md" }]),
  ".claude/ideas.md": "One question at a time.\n",
};

describe("prompt-context.mjs", () => {
  it("adds the file to a prompt that matches, whatever its case", async () => {
    const { status, context } = await prompt(protocol, "  /Brainstorm the onboarding");
    expect(status).toBe(0);
    expect(context).toEqual({ hookEventName: "UserPromptSubmit", additionalContext: "One question at a time." });
  });

  it("adds nothing to a prompt that does not match", async () => {
    expect(await prompt(protocol, "fix the test, then brainstorm")).toEqual({ status: 0, context: null });
  });

  it("adds each matching file once, in the order of the entries", async () => {
    const files = {
      ".claude/stickler.json": config([
        { match: "deploy", file: "a.md" },
        { match: "release", file: "b.md" },
        { match: "deploy", file: "a.md" },
      ]),
      "a.md": "A",
      "b.md": "B",
    };
    expect((await prompt(files, "release and deploy")).context.additionalContext).toBe("A\n\nB");
  });

  it("skips a file that cannot be read and keeps the others", async () => {
    const files = {
      ".claude/stickler.json": config([
        { match: "x", file: "missing.md" },
        { match: "x", file: "here.md" },
      ]),
      "here.md": "here",
    };
    expect((await prompt(files, "x")).context.additionalContext).toBe("here");
  });

  it("reads no file outside the repository: a path above it is refused, a link out of it skipped", async () => {
    expect(await prompt({ ".claude/stickler.json": config([{ match: "x", file: "../out.md" }]) }, "x")).toEqual({ status: 0, context: null });
    const outside = project({ "secret.md": "secret" });
    const files = {
      ".claude/stickler.json": config([
        { match: "x", file: "link.md" },
        { match: "x", file: "here.md" },
      ]),
      "here.md": "here",
    };
    const dir = project(files);
    symlinkSync(path.join(outside, "secret.md"), path.join(dir, "link.md"));
    const { stdout } = await runExit("prompt-context.mjs", { prompt: "x" }, dir);
    expect(JSON.parse(stdout).hookSpecificOutput.additionalContext).toBe("here");
  });

  it("is silent and exits 0 with no key, on an invalid config and on input it cannot parse", async () => {
    expect(await prompt({}, "brainstorm")).toEqual({ status: 0, context: null });
    expect(await prompt({ ".claude/stickler.json": config([{ match: "(", file: "a.md" }]) }, "(")).toEqual({
      status: 0,
      context: null,
    });
    expect(await prompt({ ".claude/stickler.json": "{" }, "brainstorm")).toEqual({ status: 0, context: null });
    expect(await prompt(protocol, 42)).toEqual({ status: 0, context: null });
  });
});
