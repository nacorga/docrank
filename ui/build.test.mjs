import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { project } from "../lib/testing.mjs";
import { build } from "./build.mjs";

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");

describe("ui/dist", () => {
  it("is what ui/src builds to: run `npm run build:ui` and commit it", async () => {
    const out = project();
    await build(out);
    for (const f of ["watch.js", "watch.css"]) {
      // Compared by equality, not by diff: a stale bundle prints nothing useful.
      expect(readFileSync(path.join(out, f)).equals(readFileSync(path.join(dist, f))), f).toBe(true);
    }
  }, 60_000);
});
