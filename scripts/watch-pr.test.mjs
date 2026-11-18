import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STUBS, sandbox } from "../test/cases-runner.mjs";

const SCRIPT = path.join(import.meta.dirname, "watch-pr.mjs");
const boxes = [];
afterEach(() => boxes.splice(0).forEach((b) => b.cleanup()));

/** Runs the watcher on the stub's pull request `n`; `env` shapes what the stub answers. */
function watch(args, { env = {}, config = { branches: { integration: "develop" } }, box = sandbox({ config }) } = {}) {
  boxes.push(box);
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: box.repo,
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, PATH: `${STUBS}:${process.env.PATH}`, DOCRANK_POLL_MS: "20", DOCRANK_REGISTER_MS: "200", ...env },
  });
  return { status: r.status, out: r.stdout.trim().split("\n"), box };
}
const view = (fields) => JSON.stringify({ state: "OPEN", mergeable: "MERGEABLE", headRefName: "topic", headRefOid: "aaa", ...fields });

describe("watch-pr.mjs checks", () => {
  it("is GREEN when the checks of a pull request into a CI base pass", () => {
    expect(watch(["2"], { env: { GH_STUB_CHECKS_STATUS: "0" } })).toMatchObject({ status: 0, out: ["GREEN"] });
  });

  it("waits for the first run to register before reading the checks", () => {
    const box = sandbox({ config: { branches: { integration: "develop" } } });
    const first = path.join(box.dir, "first");
    expect(watch(["2"], { box, env: { GH_STUB_FIRST_EMPTY: first } })).toMatchObject({ status: 0, out: ["GREEN"] });
  });

  it("gives up when no check ever registers", () => {
    const box = sandbox({ config: { branches: { integration: "develop" } } });
    // The marker file cannot be created: every call answers "no checks reported".
    const never = path.join(box.dir, "no", "such", "dir", "first");
    expect(watch(["2"], { box, env: { GH_STUB_FIRST_EMPTY: never } })).toMatchObject({ status: 1, out: ["RED no check registered in time"] });
  });

  it("is RED, naming the failed and cancelled checks and no others", () => {
    const failed = JSON.stringify([
      { name: "lint", bucket: "fail", link: "http://x/1" },
      { name: "e2e", bucket: "cancel", link: "http://x/2" },
      { name: "build", bucket: "pass", link: "http://x/3" },
    ]);
    expect(watch(["2"], { env: { GH_STUB_CHECKS_STATUS: "1", GH_STUB_FAILED: failed } })).toMatchObject({
      status: 1,
      out: ["RED", "lint\tfail\thttp://x/1", "e2e\tcancel\thttp://x/2"],
    });
  });

  it("reports NO CI for a base outside pr.ciBases, and follows pr.ciBases when it names one", () => {
    expect(watch(["3"])).toMatchObject({ status: 0, out: ["NO CI on a pull request into batch/demo-walk"] });
    const config = { branches: { integration: "develop" }, pr: { ciBases: ["develop", "batch/*"] } };
    expect(watch(["3"], { config })).toMatchObject({ status: 0, out: ["GREEN"] });
  });

  it("refuses a missing or non-numeric pull request", () => {
    expect(watch([]).status).toBe(2);
    expect(watch(["x"]).status).toBe(2);
  });
});

describe("watch-pr.mjs merged", () => {
  it("is MERGED with the merge commit, once the branch tip on the remote is the merged head", () => {
    const box = sandbox();
    const remote = path.join(box.dir, "origin.git");
    box.git(box.dir, "init", "-q", "--bare", remote);
    box.git(box.repo, "remote", "add", "origin", remote);
    box.git(box.repo, "push", "-q", "origin", "main:topic");
    const head = box.git(box.repo, "rev-parse", "HEAD");
    const merged = (oid) => view({ state: "MERGED", headRefOid: oid, mergeCommit: { oid: "m3rge" } });
    expect(watch(["2", "merged"], { box, env: { GH_STUB_VIEW: merged(head) } })).toMatchObject({ status: 0, out: ["MERGED m3rge"] });
    // A commit that reached the branch after the merge reaches nothing.
    expect(watch(["2", "merged"], { box, env: { GH_STUB_VIEW: merged("b".repeat(40)) } }).out[0]).toMatch(
      /^ORPHANED origin\/topic is at \w+, past the merged head b+$/,
    );
  });

  it("is CLOSED, or CONFLICTING when another merge left it so, and waits through UNKNOWN", () => {
    expect(watch(["2", "merged"], { env: { GH_STUB_VIEW: view({ state: "CLOSED" }) } })).toMatchObject({ status: 1, out: ["CLOSED"] });
    expect(watch(["2", "merged"], { env: { GH_STUB_VIEW: view({ mergeable: "CONFLICTING" }) } })).toMatchObject({ status: 1, out: ["CONFLICTING"] });
    const r = spawnSync(process.execPath, [SCRIPT, "2", "merged"], {
      cwd: sandbox().repo,
      encoding: "utf8",
      timeout: 300,
      env: { ...process.env, PATH: `${STUBS}:${process.env.PATH}`, DOCRANK_POLL_MS: "20", GH_STUB_VIEW: view({ mergeable: "UNKNOWN" }) },
    });
    expect(r.stdout).toBe("");
    expect(r.error?.code).toBe("ETIMEDOUT");
  });
});
