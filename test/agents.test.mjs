import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isJudgeType, isReadOnlyType, lacksSendMessage, PLUGIN_ROOT } from "../lib/agent-types.mjs";
import { loadConfig } from "../lib/config.mjs";
import { project, runHook } from "../lib/testing.mjs";

const repo = project();
const defaults = loadConfig({ cwd: repo, env: { CLAUDE_PROJECT_DIR: repo } });
const mcp = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, ".mcp.json"), "utf8")).mcpServers;

/** The plugin's agents, each with its frontmatter read line by line: `key: value` or a `- item` list. */
const agents = readdirSync(path.join(PLUGIN_ROOT, "agents"))
  .filter((file) => file.endsWith(".md"))
  .map((file) => {
    const text = readFileSync(path.join(PLUGIN_ROOT, "agents", file), "utf8");
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/u.exec(text);
    expect(match, `${file} has no frontmatter`).not.toBeNull();
    const front = {};
    let last;
    for (const line of match[1].split("\n")) {
      const item = /^\s+-\s+(.+)$/u.exec(line);
      if (item) front[last] = [...(Array.isArray(front[last]) ? front[last] : []), item[1]];
      else {
        const pair = /^(\w+):\s*(.*)$/u.exec(line);
        expect(pair, `${file}: "${line}" is not a frontmatter line`).not.toBeNull();
        [, last] = pair;
        front[last] = pair[2];
      }
    }
    return { file, front, body: match[2] };
  });

/** The browser tools a reviewer may hold: those that open, size, read and close a page, never one that acts on it. */
const browserReads = ["new_page", "navigate_page", "resize_page", "emulate", "take_screenshot", "take_snapshot", "evaluate_script", "wait_for", "list_pages", "select_page", "close_page"]
  .flatMap((tool) => Object.keys(mcp).map((server) => `mcp__plugin_stickler_${server}__${tool}`));
const judgeTools = new Set(["Read", "Grep", "Glob", "Bash", "SendMessage", ...browserReads]);

describe("the plugin's agents", () => {
  it("are the two judges", () => {
    expect(agents.map((a) => a.front.name).sort()).toEqual(["spec-arbiter", "surface-reviewer"]);
  });

  it.each(agents.map((a) => [a.file, a]))("%s parses, is a read-only judge and names only tools a judge may hold", (_file, { front }) => {
    const type = `stickler:${front.name}`;
    expect(front.description.length).toBeGreaterThan(0);
    expect(front.mcpServers, "ignored for plugin agents (harness-facts § 6)").toBeUndefined();
    const tools = front.tools.split(",").map((t) => t.trim());
    expect(tools.filter((t) => !judgeTools.has(t))).toEqual([]);
    expect(isReadOnlyType(type, repo)).toBe(true);
    expect(isJudgeType(type, repo, defaults.judges.skill)).toBe(true);
    expect(lacksSendMessage(type, repo)).toBe(false);
  });

  it.each(agents.map((a) => [a.file, a]))("%s has its Bash held to reads by the read-only guard", async (_file, { front }) => {
    const decide = async (command) =>
      (await runHook("guard-read-only.mjs", { tool_name: "Bash", tool_input: { command }, agent_type: `stickler:${front.name}` }, repo))
        ?.permissionDecision ?? null;
    expect(await decide("git diff main...HEAD")).toBeNull();
    expect(await decide("git rev-parse --show-toplevel")).toBeNull();
    expect(await decide("rm -rf docs")).toBe("deny");
    expect(await decide("git commit -m x")).toBe("deny");
  });

  it.each(agents.map((a) => [a.file, a]))("%s names only config keys the loader defines", (_file, { front, body }) => {
    const named = [...`${front.description}\n${body}`.matchAll(/`(\w+)\.(\w+)(?:\.\*)?`/gu)]
      .map(([, group, key]) => [group, key])
      .filter(([group]) => group in defaults);
    expect(named.length).toBeGreaterThan(0);
    for (const [group, key] of named) expect(defaults[group], `${group}.${key}`).toHaveProperty(key);
  });

  it("pins the browser server to an exact version on a throwaway headless profile", () => {
    for (const server of Object.values(mcp)) {
      expect(server.args.find((a) => a.startsWith("chrome-devtools-mcp@"))).toMatch(/@\d+\.\d+\.\d+$/u);
      expect(server.args).toEqual(expect.arrayContaining(["--isolated", "--headless"]));
    }
  });

  it("the doc-lint skill names only config keys the loader defines", () => {
    const text = readFileSync(path.join(PLUGIN_ROOT, "skills/doc-lint/SKILL.md"), "utf8");
    const named = [...text.matchAll(/`(\w+)\.(\w+)`/gu)].filter(([, group]) => group in defaults);
    expect(named.length).toBeGreaterThan(0);
    for (const [, group, key] of named) expect(defaults[group], `${group}.${key}`).toHaveProperty(key);
  });
});
