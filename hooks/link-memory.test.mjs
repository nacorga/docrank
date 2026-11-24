import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { project } from "../lib/testing.mjs";

// The hook reports in plain text, which `runHook` would try to parse.
const run = (hook, input, dir) =>
  new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [path.join(import.meta.dirname, hook)], { cwd: dir }, (e, out) => (e ? reject(e) : resolve(out)));
    child.stdin.end(JSON.stringify({ cwd: dir, ...input }));
  });

/** A repository tracking `.claude/memory`, and a fake Claude home holding a project directory. */
function setup(config = { memory: { link: true } }) {
  const repo = project({ ".claude/stickler.json": JSON.stringify(config), ".claude/memory/MEMORY.md": "index" });
  execFileSync("git", ["-C", repo, "init", "-q"]);
  const home = project({});
  const projectDir = path.join(home, ".claude", "projects", "slug");
  mkdirSync(projectDir, { recursive: true });
  return { repo, projectDir, transcript: path.join(projectDir, "s.jsonl") };
}
const memory = (projectDir) => path.join(projectDir, "memory");

describe("link-memory.mjs", () => {
  it("links the transcript's project directory to the tracked memory", async () => {
    const { repo, projectDir, transcript } = setup();
    expect(await run("link-memory.mjs", { transcript_path: transcript }, repo)).toContain("now writes to");
    expect(readlinkSync(memory(projectDir))).toBe(path.join(repo, ".claude", "memory"));
    expect(await run("link-memory.mjs", { transcript_path: transcript }, repo)).toBe("");
  });

  it("moves a real directory holding files aside, and removes an empty one", async () => {
    const { repo, projectDir, transcript } = setup();
    mkdirSync(memory(projectDir));
    writeFileSync(path.join(memory(projectDir), "kept.md"), "mine");
    expect(await run("link-memory.mjs", { transcript_path: transcript }, repo)).toContain("moved aside");
    const aside = readdirSync(projectDir).find((name) => name.startsWith("memory.orphan-"));
    expect(readFileSync(path.join(projectDir, aside, "kept.md"), "utf8")).toBe("mine");
    expect(lstatSync(memory(projectDir)).isSymbolicLink()).toBe(true);
  });

  it("does nothing while memory.link is off, the default", async () => {
    const { repo, projectDir, transcript } = setup({});
    expect(await run("link-memory.mjs", { transcript_path: transcript }, repo)).toBe("");
    expect(readdirSync(projectDir)).toEqual([]);
  });

  it("refuses, and says so, when the directory is not a Claude projects directory", async () => {
    const { repo } = setup();
    const stray = path.join(repo, "elsewhere", "s.jsonl");
    expect(await run("link-memory.mjs", { transcript_path: stray }, repo)).toContain("not linked");
    expect(await run("link-memory.mjs", {}, repo)).toContain("no transcript_path");
    expect(readdirSync(repo)).not.toContain("elsewhere");
  });

  it("does nothing when the repository does not track .claude/memory", async () => {
    const { repo, projectDir, transcript } = setup();
    execFileSync("rm", ["-r", path.join(repo, ".claude", "memory")]);
    expect(await run("link-memory.mjs", { transcript_path: transcript }, repo)).toBe("");
    expect(readdirSync(projectDir)).toEqual([]);
  });
});
