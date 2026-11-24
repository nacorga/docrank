import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseCases, sandbox } from "../test/cases-runner.mjs";

const casesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "test", "cases");

describe.each(readdirSync(casesDir).filter((f) => f.endsWith(".cases")))("cases: %s", (file) => {
  const { config, cases } = parseCases(path.join(casesDir, file));
  const box = sandbox({ config });
  afterAll(box.cleanup);
  it.each(cases)("$expect $at | $command", ({ expect: want, at, command }) => {
    const { status, stderr } = box.run(command, { at });
    expect(status === 0 ? "ALLOW" : "BLOCK", stderr).toBe(want);
    // A refusal says why; a silent exit 2 would leave the model guessing.
    if (want === "BLOCK") expect(stderr).toMatch(/^BLOCKED: /);
  });
});

describe("the extraDeny example in docs/config.md", () => {
  const docs = readFileSync(path.join(casesDir, "..", "..", "docs", "config.md"), "utf8");
  const config = JSON.parse(docs.match(/## Example: guarding a local database[\s\S]*?```json\n([\s\S]*?)```/)[1]);
  it("refuses what it names and nothing near it", () => {
    const box = sandbox({ config });
    expect(box.run("docker volume rm app_pgdata").status).toBe(2);
    expect(box.run("docker volume rm other_data").status).toBe(0);
    box.cleanup();
  });
});

describe("the case-insensitive example in docs/config.md", () => {
  const docs = readFileSync(path.join(casesDir, "..", "..", "docs", "config.md"), "utf8");
  const config = JSON.parse(docs.match(/## Example: refusing a statement whatever its case[\s\S]*?```json\n([\s\S]*?)```/)[1]);
  const box = sandbox({ config });
  afterAll(box.cleanup);
  it("refuses a statement through a client in any case, and lets a search for its words pass", () => {
    expect(box.run('psql "$URL" -c "Drop Table orders"').status).toBe(2);
    expect(box.run('psql "$URL" -c "TRUNCATE orders"').status).toBe(2);
    expect(box.run('grep -rn "DROP TABLE" migrations/').status).toBe(0);
    expect(box.run('psql "$URL" -c "SELECT 1"').status).toBe(0);
  });
});

describe("a refusal", () => {
  it("is logged to the audit log under HOME", () => {
    const box = sandbox();
    box.run("git reset --hard");
    const log = path.join(box.dir, ".claude", "blocked-commands.log");
    expect(readLog(log)).toMatch(/git-destructive\n {2}cmd: git reset --hard/);
    box.cleanup();
  });

  it("stands for an unusable configuration: nothing is checked, so it is fixed first", () => {
    const box = sandbox({ config: { branches: { integration: 3 } } });
    const { status, stderr } = box.run("git status");
    expect(status).toBe(2);
    expect(stderr).toContain("branches.integration: expected a string");
    box.cleanup();
  });
});

describe("guard.extraDeny flags", () => {
  const refuses = (entry, command) => {
    const box = sandbox({ config: { guard: { extraDeny: [{ reason: "held", ...entry }] } } });
    const status = box.run(command).status;
    box.cleanup();
    return status === 2;
  };
  it("i: matches whatever the case, and without it does not", () => {
    expect(refuses({ pattern: "wipe data", flags: "i" }, "echo WIPE Data")).toBe(true);
    expect(refuses({ pattern: "wipe data" }, "echo WIPE Data")).toBe(false);
  });
  it("m: ^ and $ stand at each line of a multi-line command", () => {
    expect(refuses({ pattern: "^wipe$", flags: "m" }, "echo a\nwipe\necho b")).toBe(true);
    expect(refuses({ pattern: "^wipe$" }, "echo a\nwipe\necho b")).toBe(false);
  });
  it("s: a dot reaches across a line break", () => {
    expect(refuses({ pattern: "wipe.run", flags: "s" }, "wipe\nrun")).toBe(true);
    expect(refuses({ pattern: "wipe.run" }, "wipe\nrun")).toBe(false);
  });
});

describe("a version floor the installed plugin does not meet", () => {
  it("refuses every command, naming both versions and the update command", () => {
    const box = sandbox({ config: { requires: "999.0.0" } });
    const { status, stderr } = box.run("git status");
    expect(status).toBe(2);
    expect(stderr).toMatch(/needs docrank 999\.0\.0 or newer and docrank \d+\.\d+\.\d+ is installed/u);
    expect(stderr).toContain("claude plugin update docrank@docrank");
    box.cleanup();
  });
});

const readLog = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

describe("deleting a branch whose pull request merged", () => {
  const box = sandbox({ config: {} });
  afterAll(box.cleanup);
  const tip = (ref) => box.git(box.repo, "rev-parse", ref);
  box.git(box.repo, "branch", "feat/done");
  box.git(box.repo, "update-ref", "refs/remotes/origin/feat/done", tip("feat/done"));

  const merged = (heads) => ({ env: { GH_STUB_MERGED_HEADS: heads } });
  it("is allowed when GitHub's merged head is the branch's tip, locally and on the remote", () => {
    expect(box.run("git branch -D feat/done", merged(tip("feat/done"))).status).toBe(0);
    expect(box.run("git push origin --delete feat/done", merged(tip("feat/done"))).status).toBe(0);
    expect(box.run("git push origin :feat/done", merged(tip("feat/done"))).status).toBe(0);
  });
  it("is refused when the merged head is another commit, or GitHub names none", () => {
    expect(box.run("git branch -D feat/done", merged("0".repeat(40))).status).toBe(2);
    expect(box.run("git branch -D feat/done").status).toBe(2);
    expect(box.run("git push origin --delete feat/done", merged("0".repeat(40))).status).toBe(2);
  });
  it("is refused for a branch that does not exist", () => {
    expect(box.run("git branch -D feat/ghost", merged(tip("feat/done"))).status).toBe(2);
  });
});

describe("a push needs the gates", () => {
  const config = { gates: { run: [{ name: "all", command: "true" }] } };
  const record = (box, name = "docrank-gates-passed") => path.join(box.commonDir, name);
  const commit = (box, msg) => {
    box.git(box.wt, "commit", "-q", "--allow-empty", "-m", msg);
    return box.git(box.wt, "rev-parse", "HEAD");
  };
  const push = (box, command = "git push origin topic", opts) => box.run(command, opts);

  it("refuses a commit the record does not list, naming it, and allows it once listed", () => {
    const box = sandbox({ config });
    box.run("true"); // puts the worktree on `topic`
    const sha = commit(box, "work");
    const refused = push(box);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain(sha.slice(0, 7));
    writeFileSync(record(box), `${"1".repeat(40)}\n${sha}\n`);
    expect(push(box).status).toBe(0);
    box.cleanup();
  });

  it("checks the tip of each pushed ref: a recorded parent does not carry its child", () => {
    const box = sandbox({ config });
    box.run("true");
    writeFileSync(record(box), `${commit(box, "one")}\n`);
    commit(box, "two");
    expect(push(box).status).toBe(2);
    box.cleanup();
  });

  it("allows what origin's integration branch already holds", () => {
    const box = sandbox({ config });
    box.run("true");
    const sha = commit(box, "merged upstream");
    expect(push(box).status).toBe(2);
    box.git(box.repo, "update-ref", "refs/remotes/origin/main", sha);
    expect(push(box).status).toBe(0);
    box.cleanup();
  });

  it("reads origin/<integration> and the record file name from the config", () => {
    const box = sandbox({
      config: { ...config, branches: { integration: "develop" }, gates: { ...config.gates, record: "passed-here" } },
    });
    box.run("true");
    const sha = commit(box, "work");
    box.git(box.repo, "update-ref", "refs/remotes/origin/main", sha);
    expect(push(box).status).toBe(2); // main is no longer the integration branch
    writeFileSync(record(box, "docrank-gates-passed"), `${sha}\n`);
    expect(push(box).status).toBe(2); // the default file name is not the configured one
    writeFileSync(record(box, "passed-here"), `${sha}\n`);
    expect(push(box).status).toBe(0);
    box.cleanup();
  });

  it("resolves bare pushes, HEAD, src:dst refspecs and --all to the commits they push", () => {
    const box = sandbox({ config });
    box.run("true");
    const sha = commit(box, "work");
    for (const command of ["git push", "git push origin", "git push origin HEAD", "git push origin topic:other", "git push -u origin +topic", "git push --all origin"]) {
      expect(push(box, command).status, command).toBe(2);
    }
    // --all pushes every local branch, `main` included: each tip is held to the record.
    expect(push(box, "git push --all origin").status).toBe(2);
    writeFileSync(record(box), `${sha}\n${box.git(box.repo, "rev-parse", "main")}\n`);
    for (const command of ["git push", "git push origin HEAD", "git push origin topic:other", "git push --all origin"]) {
      expect(push(box, command).status, command).toBe(0);
    }
    box.cleanup();
  });

  it("does not check tags, deletions or dry runs", () => {
    const box = sandbox({ config });
    box.run("true");
    commit(box, "work");
    box.git(box.wt, "tag", "v1");
    expect(push(box, "git push origin v1").status).toBe(0);
    expect(push(box, "git push origin refs/tags/v1").status).toBe(0);
    expect(push(box, "git push --tags").status).toBe(0);
    expect(push(box, "git push -n origin topic").status).toBe(0);
    expect(push(box, "git push --dry-run origin topic").status).toBe(0);
    expect(push(box, "git push origin topic").status).toBe(2);
    box.cleanup();
  });

  it("holds every push of a compound command", () => {
    const box = sandbox({ config });
    box.run("true");
    commit(box, "work");
    expect(push(box, "npm test && git push origin topic").status).toBe(2);
    box.cleanup();
  });

  it("is off when requireBeforePush is false, and moot while there are no gates", () => {
    for (const c of [{ gates: { ...config.gates, requireBeforePush: false } }, {}]) {
      const box = sandbox({ config: c });
      box.run("true");
      commit(box, "work");
      expect(push(box).status).toBe(0);
      box.cleanup();
    }
  });

  it("reads the worktree it runs in: the record is shared through the common directory", () => {
    const box = sandbox({ config });
    box.run("true");
    const sha = commit(box, "work");
    writeFileSync(record(box), `${sha}\n`);
    expect(push(box, "git -C " + box.wt + " push origin topic", { at: "main" }).status).toBe(0);
    box.cleanup();
  });
});
