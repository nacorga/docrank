import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { sandbox } from "../test/cases-runner.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "run-gates.mjs");
const PRE_PUSH = path.join(here, "..", "templates", "pre-push");
const dirs = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const gitIn = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

/** A committed repository with `.claude/docrank.json` holding `gates`. */
function repo(gates) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "docrank-gates-test-")));
  dirs.push(dir);
  gitIn(dir, "init", "-q", "-b", "main");
  gitIn(dir, "config", "user.email", "test@example.com");
  gitIn(dir, "config", "user.name", "test");
  mkdirSync(path.join(dir, ".claude"));
  writeFileSync(path.join(dir, ".claude", "docrank.json"), JSON.stringify({ gates }));
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-qm", "seed");
  return dir;
}

const gate = (name, command = "true") => ({ name, command });
const run = (args, cwd, env = {}) => {
  const r = spawnSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const verdicts = (stdout) => stdout.split("\n").filter((l) => /^(PASS|FAIL) /.test(l));
const record = (dir, name = "docrank-gates-passed") => {
  const file = path.join(gitIn(dir, "rev-parse", "--path-format=absolute", "--git-common-dir"), name);
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
};

describe("run-gates", () => {
  it("runs the gates in configured order, one PASS line each, from the root", () => {
    const dir = repo({ run: [gate("one", "pwd > order.txt"), gate("two", "echo two >> order.txt"), gate("three")] });
    const { status, stdout } = run([], path.join(dir, ".claude"));
    expect(status).toBe(0);
    expect(verdicts(stdout)).toEqual(["PASS one", "PASS two", "PASS three"]);
    expect(readFileSync(path.join(dir, "order.txt"), "utf8")).toBe(`${dir}\ntwo\n`);
    expect(stdout).toMatch(/logs in \S+/);
  });

  it("stops at the first failure and prints the tail of its log", () => {
    const dir = repo({ run: [gate("one"), gate("two", "echo broken-here; exit 3"), gate("three", "touch ran-three")] });
    const { status, stdout } = run([], dir);
    expect(status).toBe(1);
    expect(verdicts(stdout)).toEqual(["PASS one", "FAIL two"]);
    expect(stdout).toContain("broken-here");
    expect(existsSync(path.join(dir, "ran-three"))).toBe(false);
  });

  it("keeps only the last lines of a long log, and says where the whole of it is", () => {
    const dir = repo({ run: [gate("noisy", "seq 1 200; exit 1")] });
    const { stdout } = run([], dir);
    const log = stdout.match(/^log: (\S+)$/m)[1];
    expect(readFileSync(log, "utf8")).toMatch(/^1\n/);
    expect(stdout).not.toContain("\n1\n");
    expect(stdout).toContain("\n200\n");
  });

  it("runs only the gates named, in configured order, and records nothing", () => {
    const dir = repo({ run: [gate("a"), gate("b"), gate("c")] });
    const { stdout } = run(["c", "a"], dir);
    expect(verdicts(stdout)).toEqual(["PASS a", "PASS c"]);
    expect(record(dir)).toEqual([]);
  });

  describe("jobs", () => {
    const gates = { run: [gate("lint")], jobs: { e2e: "echo job > job.txt", slow: "exit 1" } };

    it("run only when named, after the gates", () => {
      const dir = repo(gates);
      expect(verdicts(run([], dir).stdout)).toEqual(["PASS lint"]);
      expect(existsSync(path.join(dir, "job.txt"))).toBe(false);
      expect(verdicts(run(["e2e", "lint"], dir).stdout)).toEqual(["PASS lint", "PASS e2e"]);
    });

    it("named alone run without the gates", () => {
      const dir = repo({ run: [gate("lint", "touch gate-ran")], jobs: gates.jobs });
      expect(verdicts(run(["e2e"], dir).stdout)).toEqual(["PASS e2e"]);
      expect(existsSync(path.join(dir, "gate-ran"))).toBe(false);
    });

    it("do not run when a gate failed first", () => {
      const dir = repo({ run: [gate("lint", "exit 1")], jobs: gates.jobs });
      expect(verdicts(run(["lint", "e2e"], dir).stdout)).toEqual(["FAIL lint"]);
    });

    it("fail the run, after the gates passed and were recorded", () => {
      const dir = repo(gates);
      const { status, stdout } = run(["slow"], dir);
      expect(status).toBe(1);
      expect(verdicts(stdout)).toEqual(["FAIL slow"]);
      const all = run(["lint", "slow"], dir);
      expect(all.status).toBe(1);
      expect(record(dir)).toEqual([gitIn(dir, "rev-parse", "HEAD")]);
    });

    it("an unknown name is an error listing the valid ones, and nothing runs", () => {
      const dir = repo({ run: [gate("lint", "touch gate-ran")], jobs: gates.jobs });
      const { status, stderr } = run(["lint", "nope"], dir);
      expect(status).toBe(1);
      expect(stderr).toContain('Unknown name "nope". Gates: lint; jobs: e2e, slow');
      expect(existsSync(path.join(dir, "gate-ran"))).toBe(false);
    });
  });

  describe("the record", () => {
    it("takes HEAD when every gate passed on a clean tree whose HEAD did not move", () => {
      const dir = repo({ run: [gate("a"), gate("b")] });
      const { stdout } = run([], dir);
      expect(record(dir)).toEqual([gitIn(dir, "rev-parse", "HEAD")]);
      expect(stdout).toContain("recorded");
    });

    it("takes the name from gates.record, in the common directory", () => {
      const dir = repo({ run: [gate("a")], record: "my-record" });
      run([], dir);
      expect(record(dir, "my-record")).toEqual([gitIn(dir, "rev-parse", "HEAD")]);
      expect(record(dir)).toEqual([]);
    });

    it("is not written when a gate failed", () => {
      const dir = repo({ run: [gate("a"), gate("b", "exit 1")] });
      run([], dir);
      expect(record(dir)).toEqual([]);
    });

    it("is not written when the tree was dirty before the run", () => {
      const dir = repo({ run: [gate("a")] });
      writeFileSync(path.join(dir, "dirty.txt"), "x");
      const { stdout } = run([], dir);
      expect(stdout).toContain("+dirty");
      expect(record(dir)).toEqual([]);
    });

    it("is not written when a gate left the tree dirty", () => {
      const dir = repo({ run: [gate("a", "touch made-by-gate")] });
      run([], dir);
      expect(record(dir)).toEqual([]);
    });

    it("is not written when HEAD moved during the run", () => {
      const dir = repo({ run: [gate("a", "git commit -q --allow-empty -m moved")] });
      const before = gitIn(dir, "rev-parse", "HEAD");
      run([], dir);
      expect(gitIn(dir, "rev-parse", "HEAD")).not.toBe(before);
      expect(record(dir)).toEqual([]);
    });
  });

  describe("the root", () => {
    it("-C beats the working directory and CLAUDE_PROJECT_DIR", () => {
      const target = repo({ run: [gate("here", "touch ran-here")] });
      const other = repo({ run: [gate("there", "touch ran-there")] });
      const { stdout } = run(["-C", target], other, { CLAUDE_PROJECT_DIR: other });
      expect(stdout.startsWith(`tree ${target} @ `)).toBe(true);
      expect(verdicts(stdout)).toEqual(["PASS here"]);
      expect(existsSync(path.join(other, "ran-there"))).toBe(false);
    });

    it("the working directory's git top level beats CLAUDE_PROJECT_DIR", () => {
      const cwd = repo({ run: [gate("here")] });
      const other = repo({ run: [gate("there")] });
      expect(run([], cwd, { CLAUDE_PROJECT_DIR: other }).stdout.startsWith(`tree ${cwd} @ `)).toBe(true);
    });

    it("CLAUDE_PROJECT_DIR is the last resort", () => {
      const project = repo({ run: [gate("here")] });
      const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "docrank-nogit-")));
      dirs.push(outside);
      expect(run([], outside, { CLAUDE_PROJECT_DIR: project }).stdout.startsWith(`tree ${project} @ `)).toBe(true);
    });

    it("-C without a directory exits 2", () => {
      const r = run(["-C"], repo({ run: [gate("a")] }));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("-C needs a directory");
    });

    it("-C outside any git work tree exits 1 rather than gating another tree", () => {
      const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "docrank-nogit-")));
      dirs.push(outside);
      const r = run(["-C", outside], repo({ run: [gate("a")] }));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`"${outside}" is not inside a git work tree.`);
    });

    it("an invalid config refuses with its messages", () => {
      const r = run([], repo({ run: [{ name: "a" }] }));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("gates.run[0].command");
    });
  });

  it("with no gates configured, there is nothing to run and nothing recorded", () => {
    const dir = repo({});
    const r = run([], dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("nothing to run");
    expect(record(dir)).toEqual([]);
  });
});

describe("the record, read back by the Bash guard's push check", () => {
  it("refuses a push before the gates passed, allows it after, refuses a commit made since", () => {
    const box = sandbox({ config: { gates: { run: [gate("lint")] } } });
    const push = () => box.run("git push origin feat", { at: "feat" });
    try {
      const before = push();
      expect(before.status).toBe(2);
      expect(before.stderr).toContain("the gates have not passed on");

      expect(run([], box.repo).status).toBe(0);
      expect(push().status).toBe(0);

      writeFileSync(path.join(box.repo, "more.txt"), "more");
      box.git(box.repo, "add", "more.txt");
      box.git(box.repo, "commit", "-qm", "more");
      expect(push().status).toBe(2);
    } finally {
      box.cleanup();
    }
  });

  it("a failed gate leaves the push refused", () => {
    const box = sandbox({ config: { gates: { run: [gate("lint", "exit 1")] } } });
    try {
      expect(box.run("git push origin feat", { at: "feat" }).status).toBe(2);
      expect(run([], box.repo).status).toBe(1);
      expect(box.run("git push origin feat", { at: "feat" }).status).toBe(2);
    } finally {
      box.cleanup();
    }
  });
});

describe("templates/pre-push", () => {
  const ZERO = "0".repeat(40);
  const line = (sha, ref = "refs/heads/feat") => `${ref} ${sha} ${ref} ${ZERO}\n`;
  const push = (dir, input) =>
    spawnSync("sh", [PRE_PUSH, "origin", "url"], { cwd: dir, input, encoding: "utf8" });
  const head = (dir) => gitIn(dir, "rev-parse", "HEAD");
  const commit = (dir, name) => {
    writeFileSync(path.join(dir, name), name);
    gitIn(dir, "add", name);
    gitIn(dir, "commit", "-qm", name);
    return head(dir);
  };

  it("passes a recorded commit, one origin holds, a deletion and a tag, and refuses the rest", () => {
    const dir = repo({ run: [gate("lint")] });
    const onMain = head(dir);
    gitIn(dir, "update-ref", "refs/remotes/origin/main", onMain);
    const fresh = commit(dir, "more");

    const refused = push(dir, line(fresh));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(`the gates have not passed on ${fresh.slice(0, 7)}`);
    expect(push(dir, line(onMain)).status).toBe(0);
    expect(push(dir, `refs/heads/feat ${ZERO} refs/heads/feat ${fresh}\n`).status).toBe(0);
    expect(push(dir, line(fresh, "refs/tags/v1")).status).toBe(0);

    expect(run([], dir).status).toBe(0);
    expect(push(dir, line(fresh)).status).toBe(0);
  });

  it("reads the record's name and the integration branch from the config", () => {
    const dir = repo({ run: [gate("lint")], record: "elsewhere" });
    const config = JSON.parse(readFileSync(path.join(dir, ".claude", "docrank.json"), "utf8"));
    config.branches = { integration: "develop" };
    writeFileSync(path.join(dir, ".claude", "docrank.json"), JSON.stringify(config));
    gitIn(dir, "commit", "-qam", "develop");
    const held = head(dir);
    gitIn(dir, "update-ref", "refs/remotes/origin/develop", held);
    const fresh = commit(dir, "more");

    expect(push(dir, line(held)).status).toBe(0);
    expect(push(dir, line(fresh)).status).toBe(1);
    writeFileSync(path.join(gitIn(dir, "rev-parse", "--path-format=absolute", "--git-common-dir"), "elsewhere"), `${fresh}\n`);
    expect(push(dir, line(fresh)).status).toBe(0);
  });

  it("lets everything through when no gates are configured or the push check is off", () => {
    for (const gates of [{}, { run: [gate("lint")], requireBeforePush: false }]) {
      const dir = repo(gates);
      expect(push(dir, line(commit(dir, "more"))).status).toBe(0);
    }
  });

  it("runs as a git hook, and the guard and the hook agree on the same record", () => {
    const dir = repo({ run: [gate("lint")] });
    const remote = path.join(dir, "..", `${path.basename(dir)}-remote.git`);
    gitIn(dir, "init", "-q", "--bare", remote);
    dirs.push(remote);
    gitIn(dir, "remote", "add", "origin", remote);
    const hook = path.join(dir, ".git", "hooks", "pre-push");
    writeFileSync(hook, readFileSync(PRE_PUSH));
    chmodSync(hook, 0o755);
    const attempt = () => spawnSync("git", ["-C", dir, "push", "-q", "origin", "main"], { encoding: "utf8" });
    expect(attempt().status).not.toBe(0);
    expect(run([], dir).status).toBe(0);
    expect(attempt().status).toBe(0);
  });
});
