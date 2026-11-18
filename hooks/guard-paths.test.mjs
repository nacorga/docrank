import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { project, runHook } from "../lib/testing.mjs";

const tracked = "gen/old.sql";
const config = {
  paths: {
    rules: [
      { pattern: "^gen/new-", reason: "generated; run the generator instead." },
      { pattern: "^gen/.*\\.sql$", onlyIfTracked: true, reason: "applied; write a new file instead." },
    ],
  },
};
const dir = project({ ".claude/docrank.json": JSON.stringify(config), [tracked]: "", "src/app.js": "" });
const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", dir, ...args]);
git("init", "-q");
git("add", tracked);
git("commit", "-qm", "base");

/** The deny reason for editing `file`, or null. */
async function decide(file, where = dir) {
  const output = await runHook("guard-paths.mjs", { tool_name: "Edit", tool_input: { file_path: file } }, where);
  if (!output) return null;
  expect(output.permissionDecision).toBe("deny");
  return output.permissionDecisionReason;
}

describe("guard-paths.mjs", () => {
  it.each([".env", ".env.local", "apps/web/.env.production", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "web/bun.lock"])(
    "refuses the built-in %s and names the alternative",
    async (file) => {
      expect(await decide(`${dir}/${file}`)).toMatch(/instead|Document|Change the manifest/u);
    },
  );

  it.each([".env.example", "src/app.js", "docs/lock.md", "environment.ts"])("lets %s through", async (file) => {
    expect(await decide(`${dir}/${file}`)).toBeNull();
  });

  it("reads relative paths from the repository root", async () => {
    expect(await decide(".env")).toContain(".env:");
  });

  it("leaves files outside the repository alone", async () => {
    expect(await decide("/etc/hosts")).toBeNull();
    expect(await decide(`${project()}/.env`)).toBeNull();
  });

  it("turns the built-ins off with paths.builtIns", async () => {
    const off = project({ ".claude/docrank.json": JSON.stringify({ paths: { builtIns: false } }) });
    expect(await decide(`${off}/.env`, off)).toBeNull();
  });

  it("refuses what a rule matches, with the rule's reason", async () => {
    expect(await decide(`${dir}/gen/new-thing.txt`)).toBe("gen/new-thing.txt: generated; run the generator instead.");
  });

  it("holds an onlyIfTracked rule to files git tracks", async () => {
    expect(await decide(`${dir}/${tracked}`)).toContain("applied");
    expect(await decide(`${dir}/gen/fresh.sql`)).toBeNull();
  });

  it("refuses the call when the config is invalid", async () => {
    const bad = project({ ".claude/docrank.json": '{"paths":{"builtIns":"yes"}}' });
    expect(await decide(`${bad}/src/a.js`, bad)).toContain("paths.builtIns");
  });
});
