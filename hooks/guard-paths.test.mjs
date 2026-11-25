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
const dir = project({ ".claude/stickler.json": JSON.stringify(config), [tracked]: "", "src/app.js": "" });
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
    const off = project({ ".claude/stickler.json": JSON.stringify({ paths: { builtIns: false } }) });
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
    const bad = project({ ".claude/stickler.json": '{"paths":{"builtIns":"yes"}}' });
    expect(await decide(`${bad}/src/a.js`, bad)).toContain("paths.builtIns");
  });
});

describe("guard-paths.mjs asks before an edit to what enforces the work", () => {
  const kinds = {
    ".eslintrc.json": "a lint configuration",
    "eslint.config.mjs": "a lint configuration",
    "packages/app/.oxlintrc.json": "a lint configuration",
    "biome.json": "a lint and formatter configuration",
    ".prettierrc": "a formatter configuration",
    "prettier.config.js": "a formatter configuration",
    "tsconfig.json": "a type-check configuration",
    "packages/app/tsconfig.build.json": "a type-check configuration",
    "commitlint.config.js": "a commit-lint configuration",
    ".githooks/pre-push": "a git hook",
    ".husky/pre-commit": "a git hook",
    ".claude/hooks/check.sh": "a Claude Code hook",
    "hooks/hooks.json": "a Claude Code hook",
    ".claude/settings.json": "Claude Code settings",
    ".claude/settings.local.json": "Claude Code settings",
  };
  /* No config file: the default holds. */
  const repo = project(Object.fromEntries(Object.keys(kinds).map((file) => [file, "{}"])));

  /** The hook's answer to `tool` on `file`, or null when it passes. */
  const answer = (file, where = repo, tool = "Edit") =>
    runHook("guard-paths.mjs", { tool_name: tool, tool_input: { file_path: `${where}/${file}` } }, where);

  it.each(Object.entries(kinds))("asks for %s, naming %s, on by default", async (file, kind) => {
    for (const tool of ["Edit", "Write"]) {
      const output = await answer(file, repo, tool);
      expect(output?.permissionDecision).toBe("ask");
      expect(output.permissionDecisionReason).toBe(
        `${file}: ${kind} holds the work to its checks, and changing it can weaken them. Whether to is the user's call, not the session's.`,
      );
    }
  });

  it("lets the creation of such a file through", async () => {
    const empty = project();
    for (const file of Object.keys(kinds)) expect(await answer(file, empty, "Write")).toBeNull();
  });

  it("lets other existing files through", async () => {
    const other = project({ "src/app.ts": "", "docs/tsconfig.md": "", ".claude/stickler.json": "{}" });
    for (const file of ["src/app.ts", "docs/tsconfig.md", ".claude/stickler.json"]) expect(await answer(file, other)).toBeNull();
  });

  it("asks for what a configured pattern matches, with its reason", async () => {
    const config = { paths: { ask: [{ pattern: "^ci/", reason: "the pipeline runs the checks." }] } };
    const custom = project({ ".claude/stickler.json": JSON.stringify(config), "ci/build.yml": "" });
    const output = await answer("ci/build.yml", custom);
    expect(output.permissionDecision).toBe("ask");
    expect(output.permissionDecisionReason).toBe("ci/build.yml: the pipeline runs the checks.");
  });

  it("turns the built-in kinds off with paths.askBuiltIns", async () => {
    const off = project({ ".claude/stickler.json": JSON.stringify({ paths: { askBuiltIns: false } }), "tsconfig.json": "{}" });
    expect(await answer("tsconfig.json", off)).toBeNull();
  });

  it("refuses before it asks", async () => {
    const both = { paths: { rules: [{ pattern: "^tsconfig", reason: "generated." }] } };
    const refused = project({ ".claude/stickler.json": JSON.stringify(both), "tsconfig.json": "{}" });
    expect((await answer("tsconfig.json", refused)).permissionDecision).toBe("deny");
  });
});
