import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { project, runExit } from "../lib/testing.mjs";

// The formatter and the linter are two node one-liners standing for prettier
// and eslint: one rewrites the file, the other fails on a line holding BAD.
const sed = "node -e \"const f=process.argv[1],fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/ +/g,' '))\"";
const lint = "node -e \"const t=require('fs').readFileSync(process.argv[1],'utf8');if(t.includes('BAD')){console.log('no BAD allowed');process.exit(1)}\"";
const config = { format: { command: sed, lintCommand: lint, lintExtensions: [".js"] } };

const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-C", cwd, ...args], { stdio: "ignore" });
const repo = (files = {}, extra = config) => {
  const dir = project({ ".claude/docrank.json": JSON.stringify(extra), ...files });
  git(dir, "init", "-q");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "base");
  return dir;
};
const fire = (dir, file) => runExit("format-on-edit.mjs", { tool_name: "Write", tool_input: { file_path: file } }, dir);

describe("format-on-edit.mjs", () => {
  it("formats a file of the repository, by absolute or relative path", async () => {
    const dir = repo({ "a.txt": "a   b", "b.txt": "a   b" });
    expect((await fire(dir, path.join(dir, "a.txt"))).status).toBe(0);
    expect((await fire(dir, "b.txt")).status).toBe(0);
    expect(readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("a b");
    expect(readFileSync(path.join(dir, "b.txt"), "utf8")).toBe("a b");
  });

  it("lints a file with a configured extension, and exits 2 with the output", async () => {
    const dir = repo({ "bad.js": "BAD   x", "good.js": "ok" });
    const bad = await fire(dir, "bad.js");
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("Lint on bad.js:\nno BAD allowed");
    expect((await fire(dir, "good.js")).status).toBe(0);
  });

  it("does not lint an extension it was not given", async () => {
    const dir = repo({ "bad.txt": "BAD" });
    expect((await fire(dir, "bad.txt")).status).toBe(0);
  });

  it("leaves a file of another repository, or of none, as it was", async () => {
    const dir = repo();
    const other = repo({ "notes.txt": "a   b" });
    const loose = path.join(project({ "loose.txt": "a   b" }), "loose.txt");
    for (const file of [path.join(other, "notes.txt"), loose]) {
      expect((await fire(dir, file)).status).toBe(0);
      expect(readFileSync(file, "utf8")).toBe("a   b");
    }
  });

  it("formats a file of a sibling worktree of the repository", async () => {
    const dir = repo();
    const sibling = path.join(project(), "wt");
    git(dir, "worktree", "add", "-q", "--detach", sibling);
    writeFileSync(path.join(sibling, "n.txt"), "a   b");
    expect((await fire(dir, path.join(sibling, "n.txt"))).status).toBe(0);
    expect(readFileSync(path.join(sibling, "n.txt"), "utf8")).toBe("a b");
  });

  it("passes a path with a quote and a space to the command whole", async () => {
    const dir = repo();
    mkdirSync(path.join(dir, "it's here"));
    writeFileSync(path.join(dir, "it's here", "a b.txt"), "a   b");
    expect((await fire(dir, "it's here/a b.txt")).status).toBe(0);
    expect(readFileSync(path.join(dir, "it's here", "a b.txt"), "utf8")).toBe("a b");
  });

  it("ignores a file that does not exist", async () => {
    expect((await fire(repo(), "missing.js")).status).toBe(0);
  });

  it("is off when no command is configured", async () => {
    const dir = repo({ "a.js": "BAD   x" }, {});
    expect((await fire(dir, "a.js")).status).toBe(0);
    expect(readFileSync(path.join(dir, "a.js"), "utf8")).toBe("BAD   x");
  });
});
