import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isJudgeType } from "./agent-types.mjs";
import { ConfigError, findRoot, loadConfig } from "./config.mjs";

/** A directory that is not a git repository, with an optional config file. */
function project(config) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "docrank-")));
  if (config !== undefined) {
    mkdirSync(path.join(dir, ".claude"));
    writeFileSync(
      path.join(dir, ".claude", "docrank.json"),
      typeof config === "string" ? config : JSON.stringify(config),
    );
  }
  return dir;
}

const load = (config) => {
  const dir = project(config);
  return loadConfig({ cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
};

/** The messages a config is refused with. */
const errorsOf = (config) => {
  try {
    load(config);
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return e.errors;
  }
  throw new Error("expected the config to be refused");
};

describe("defaults", () => {
  it("applies every default when there is no file", () => {
    const c = load();
    expect(c.branches).toEqual({
      protected: ["main", "master"],
      integration: "main",
      allowedPrBases: ["main"],
    });
    expect(c.gates.run).toEqual([]);
    expect(c.dispatch).toMatchObject({ defaultModel: "sonnet", defaultEffort: "medium" });
    expect(c.judges.maxRechecks).toBe(3);
    expect(c.docDrift.baseRef).toBe("origin/main");
    expect(c.docDrift.unpaired).toEqual({});
    expect(c.pr.ciBases).toEqual(["main"]);
    expect(c.format.command).toBeNull();
    expect(c.handoff.tokenThreshold).toBe(250000);
    expect(c.memory.link).toBe(false);
    expect(c.watch).toEqual({ enabled: false, port: 47173, language: "en", retentionDays: 30 });
  });

  it("leaves the evidence keys off: no required line, no evidence header, and an empty header says so too", () => {
    expect(load().pr.requiredLines).toEqual([]);
    expect(load().messages.evidenceHeader).toBe("");
    expect(load({ messages: { evidenceHeader: "" } }).messages.evidenceHeader).toBe("");
  });

  it("derives dependent defaults from the integration branch", () => {
    const c = load({ branches: { integration: "develop" } });
    expect(c.branches.allowedPrBases).toEqual(["develop"]);
    expect(c.pr.ciBases).toEqual(["develop"]);
    expect(c.docDrift.baseRef).toBe("origin/develop");
  });

  it("is frozen all the way down", () => {
    const c = load();
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.branches.protected)).toBe(true);
    expect(() => c.branches.protected.push("x")).toThrow(TypeError);
  });

  it("does not share defaults between loads", () => {
    expect(load().branches.protected).not.toBe(load().branches.protected);
  });
});

describe("a full valid file", () => {
  const full = {
    branches: { protected: ["main"], integration: "develop", allowedPrBases: ["develop", "batch/*"] },
    guard: {
      blockedTagPatterns: ["^sdk@"],
      publishBan: false,
      extraDeny: [{ pattern: "docker\\s+volume\\s+prune", reason: "erases the database" }],
    },
    gates: {
      run: [{ name: "lint", command: "npm run lint" }, { name: "test", command: "npm test" }],
      jobs: { e2e: "npm run e2e" },
      requireBeforePush: false,
      record: "my-record",
    },
    dispatch: {
      defaultModel: "haiku",
      defaultEffort: "low",
      heavyMarker: false,
      forkBan: false,
      guardrailsFile: ".claude/guardrails.md",
    },
    judges: {
      skill: "my-protocol",
      maxRechecks: 2,
      routes: [{ agent: "spec-arbiter", ground: ["docs/**"] }],
    },
    paths: {
      builtIns: false,
      rules: [{ pattern: "^generated/", onlyIfTracked: true, reason: "generated" }],
    },
    plan: { requiredHeadings: ["Double check"] },
    format: { command: "npx prettier --write", lintCommand: "npx eslint", lintExtensions: [".ts"] },
    docDrift: {
      baseRef: "origin/develop",
      entries: [{ code: ["src/"], docs: ["docs/"] }],
      unpaired: { "src/index.ts": "the barrel" },
    },
    worktree: { copy: [".env"], install: "npm ci" },
    pr: { productPaths: ["src/"], requiredLines: ["^Gates: passed$"], checklist: "Read it.", ciBases: ["develop"] },
    docs: {
      precedence: ["docs/definition.md", ["docs/spec/", "docs/app/"]],
      invariants: "CLAUDE.md",
      registry: "tools/doc-facts.test.ts",
      scanRoots: ["docs"],
      historyRoots: ["docs/plans"],
      unitRoots: ["src"],
      groups: [{ name: "spec", paths: ["docs/spec/"] }],
    },
    surface: { paths: ["src/ui/"], widths: [375], locales: ["en", "es"], criterion: "legible" },
    ship: { plansDir: "plans", pathJobs: [{ paths: ["src/ui/"], jobs: ["e2e"] }] },
    principles: { enabled: false, reportLanguage: "Spanish", closingLine: "Next:" },
    handoff: { enabled: false, tokenThreshold: 100000, location: "docs/handoff.md" },
    memory: { link: true },
    watch: { enabled: true, port: 8123, language: "es", retentionDays: 7 },
    messages: { tools: ["mcp__mail__send"], evidenceHeader: "^\\|\\s*Claim", checklist: "Check it." },
  };

  it("is returned as written", () => {
    const c = load(full);
    for (const [group, value] of Object.entries(full)) expect(c[group]).toEqual(value);
  });

  it("covers every group the schema has", () => {
    expect(Object.keys(full).sort()).toEqual(Object.keys(load()).filter((k) => k !== "root").sort());
  });
});

describe("the keys init proposes to turn the spec arbiter on", () => {
  const proposed = {
    docs: { precedence: ["CLAUDE.md"] },
    judges: { routes: [{ agent: "docrank:spec-arbiter", ground: ["**"] }] },
  };

  it("load as written", () => {
    const c = load(proposed);
    expect(c.docs.precedence).toEqual(["CLAUDE.md"]);
    expect(c.judges.routes).toEqual(proposed.judges.routes);
  });

  it("route to the plugin's own judge", () => {
    const c = load(proposed);
    expect(isJudgeType(c.judges.routes[0].agent, c.root, c.judges.skill)).toBe(true);
  });
});

describe("invalid input names its key path", () => {
  it.each([
    ["a wrong type", { branches: { integration: 5 } }, 'branches.integration: expected a string, got 5'],
    ["an empty string", { branches: { integration: "" } }, 'branches.integration: expected a string, got ""'],
    ["a non-array", { branches: { protected: "main" } }, 'branches.protected: expected an array, got "main"'],
    ["a bad list item", { branches: { protected: ["main", 3] } }, "branches.protected[1]: expected a string, got 3"],
    ["a non-boolean", { guard: { publishBan: "yes" } }, 'guard.publishBan: expected true or false, got "yes"'],
    ["a non-integer", { judges: { maxRechecks: 1.5 } }, "judges.maxRechecks: expected an integer >= 1, got 1.5"],
    ["an out-of-range integer", { handoff: { tokenThreshold: 0 } }, "handoff.tokenThreshold: expected an integer >= 1, got 0"],
    ["a port below the range", { watch: { port: 80 } }, "watch.port: expected an integer from 1025 to 65535, got 80"],
    ["a port above the range", { watch: { port: 70000 } }, "watch.port: expected an integer from 1025 to 65535, got 70000"],
    ["a language watch does not speak", { watch: { language: "fr" } }, 'watch.language: expected one of "en", "es", got "fr"'],
    ["a value outside an enum", { dispatch: { defaultEffort: "huge" } }, 'dispatch.defaultEffort: expected one of "low", "medium", "high", "xhigh", "max", got "huge"'],
    ["a regex that does not compile", { guard: { blockedTagPatterns: ["("] } }, "guard.blockedTagPatterns[0]: expected a valid regular expression"],
    ["a pr.requiredLines entry that does not compile", { pr: { requiredLines: ["^ok", "("] } }, "pr.requiredLines[1]: expected a valid regular expression"],
    ["an empty pr.requiredLines entry", { pr: { requiredLines: [""] } }, 'pr.requiredLines[0]: expected a string holding a regular expression, got ""'],
    ["a messages.evidenceHeader that does not compile", { messages: { evidenceHeader: "[" } }, "messages.evidenceHeader: expected a valid regular expression"],
    ["a messages.evidenceHeader that is not a string", { messages: { evidenceHeader: 3 } }, "messages.evidenceHeader: expected a string holding a regular expression, got 3"],
    ["a section that is not an object", { gates: [] }, "gates: expected an object, got an array"],
    ["a missing required field", { gates: { run: [{ name: "lint" }] } }, "gates.run[0].command: expected a string, got nothing"],
    ["a nested bad field", { surface: { widths: [375, "wide"] } }, 'surface.widths[1]: expected an integer >= 1, got "wide"'],
    ["a heading that is not a string", { plan: { requiredHeadings: [1] } }, "plan.requiredHeadings[0]: expected a string, got 1"],
    ["a rank that is neither a string nor strings", { docs: { precedence: ["docs/a.md", ["docs/b/", 3]] } }, 'docs.precedence[1]: expected a string or a non-empty array of strings, got an array'],
    ["an empty rank", { docs: { precedence: [[]] } }, "docs.precedence[0]: expected a string or a non-empty array of strings, got an array"],
    ["a bad map value", { gates: { jobs: { e2e: 1 } } }, "gates.jobs.e2e: expected a string, got 1"],
    ["an unpaired code path with no reason", { docDrift: { unpaired: { "src/x": "" } } }, 'docDrift.unpaired.src/x: expected a string, got ""'],
    ["a duplicated gate name", { gates: { run: [{ name: "a", command: "x" }, { name: "a", command: "y" }] } }, 'gates.run[1].name: expected a name used once, got "a" again'],
    ["a path job that names no job", { ship: { pathJobs: [{ paths: ["src/"], jobs: ["nope"] }] } }, 'ship.pathJobs[0].jobs[0]: expected a key of gates.jobs, got "nope"'],
    ["a job named like an object member", { ship: { pathJobs: [{ paths: ["src/"], jobs: ["toString"] }] } }, 'ship.pathJobs[0].jobs[0]: expected a key of gates.jobs, got "toString"'],
  ])("%s", (_name, config, message) => {
    expect(errorsOf(config).some((e) => e.startsWith(message))).toBe(true);
  });

  it("reports every problem at once", () => {
    const errors = errorsOf({ branches: { integration: 1 }, memory: { link: "x" } });
    expect(errors).toHaveLength(2);
  });

  it("refuses a top level that is not an object", () => {
    expect(errorsOf("[]")).toEqual(["(top level): expected an object, got an array"]);
  });

  it("refuses a file that is not JSON", () => {
    expect(errorsOf("{nope")[0]).toMatch(/^\.claude\/docrank\.json: expected valid JSON/u);
  });
});

describe("unknown keys", () => {
  it("are rejected at the top level, naming the key", () => {
    expect(errorsOf({ branchs: {} })).toEqual([
      expect.stringMatching(/^branchs: unknown key \(expected one of: branches, guard,/u),
    ]);
  });

  it("are rejected inside a group, naming the path", () => {
    expect(errorsOf({ gates: { runn: [] } })[0]).toMatch(/^gates\.runn: unknown key \(expected one of: run, jobs,/u);
  });

  it("are rejected inside a list item", () => {
    expect(errorsOf({ gates: { run: [{ name: "a", command: "b", cmd: "c" }] } })[0]).toMatch(
      /^gates\.run\[0\]\.cmd: unknown key/u,
    );
  });
});

describe("finding the root", () => {
  it("uses the git top level, from a subdirectory", () => {
    const dir = project();
    execFileSync("git", ["init", "-q"], { cwd: dir });
    mkdirSync(path.join(dir, "a", "b"), { recursive: true });
    mkdirSync(path.join(dir, ".claude"));
    writeFileSync(
      path.join(dir, ".claude", "docrank.json"),
      JSON.stringify({ branches: { integration: "develop" } }),
    );
    const sub = path.join(dir, "a", "b");
    expect(findRoot({ cwd: sub, env: { CLAUDE_PROJECT_DIR: "/elsewhere" } })).toBe(dir);
    expect(loadConfig({ cwd: sub, env: {} }).branches.integration).toBe("develop");
  });

  it("falls back to CLAUDE_PROJECT_DIR outside a repository", () => {
    const dir = project();
    expect(findRoot({ cwd: dir, env: { CLAUDE_PROJECT_DIR: "/project" } })).toBe("/project");
  });

  it("is refused when it has neither", () => {
    const dir = project();
    expect(() => findRoot({ cwd: dir, env: {} })).toThrow(/no repository root/u);
  });
});
