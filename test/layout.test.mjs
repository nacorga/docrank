import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_ROOT } from "../lib/agent-types.mjs";

// claude.ai and Cowork refuse the whole plugin when it has a top-level `bin/`
// directory, so a marketplace add reports it as failing validation and cloud
// sessions never load it. The CLI lives in `cli/` for that reason.
describe("plugin layout", () => {
  it("has no top-level bin/ directory", () => {
    expect(existsSync(path.join(PLUGIN_ROOT, "bin"))).toBe(false);
  });

  it("keeps the CLI at cli/stickler.mjs", () => {
    expect(existsSync(path.join(PLUGIN_ROOT, "cli", "stickler.mjs"))).toBe(true);
  });
});
