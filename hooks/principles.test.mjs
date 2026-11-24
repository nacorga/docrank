import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_ROOT } from "../lib/agent-types.mjs";
import { project, runHook } from "../lib/testing.mjs";

const run = (config) => runHook("principles.mjs", {}, project(config ? { ".claude/stickler.json": JSON.stringify(config) } : {}));

describe("principles.mjs", () => {
  it("injects the principles and the report language by default", async () => {
    const out = await run();
    expect(out.hookEventName).toBe("SessionStart");
    expect(out.additionalContext).toContain("**Autonomy.**");
    expect(out.additionalContext).toContain("written in English");
    expect(out.additionalContext).not.toContain("ends with one line");
  });

  it("adds the closing line and the language when configured", async () => {
    const { additionalContext } = await run({ principles: { reportLanguage: "French", closingLine: "Next for you: ..." } });
    expect(additionalContext).toContain("written in French");
    expect(additionalContext).toContain('ends with one line, "Next for you: ..."');
  });

  it("injects nothing when disabled", async () => {
    expect(await run({ principles: { enabled: false } })).toBeNull();
  });

  it("injects nothing, and does not fail, on an invalid config", async () => {
    expect(await run({ principles: { enabled: "yes" } })).toBeNull();
  });
});

describe("principles/principles.md", () => {
  const text = readFileSync(path.join(PLUGIN_ROOT, "principles", "principles.md"), "utf8");

  it("carries no personal or project-specific literal", () => {
    for (const literal of [/tracelog/iu, /nacorga/iu, /te toca/iu, /progreso/iu, /\/Users\//u, /\/home\//u, /~\/\.claude/u, /[áéíóúñ¿¡]/u]) {
      expect(text).not.toMatch(literal);
    }
  });

  it("stays short, since every session carries it", () => {
    expect(text.split(/\s+/u).length).toBeLessThan(350);
  });
});
