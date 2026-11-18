import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { sandbox } from "../test/cases-runner.mjs";
import { runHook } from "../lib/testing.mjs";

const OPEN = "gh pr create --base develop --title x --body y";
const config = {
  branches: { integration: "develop" },
  pr: { productPaths: ["src/"], checklist: "Read it against the site." },
  surface: { paths: ["ui/"], criterion: "evident on first read" },
};
const boxes = [];
const sessions = [];
afterEach(() => {
  boxes.splice(0).forEach((b) => b.cleanup());
  sessions.splice(0).forEach((s) => rmSync(path.join(tmpdir(), `docrank-pr-handover-${s}`), { force: true }));
});

/** A repository whose branch changes `file` against its origin/develop. */
function branchChanging(file, cfg = config) {
  const box = sandbox({ config: cfg });
  boxes.push(box);
  box.git(box.repo, "update-ref", "refs/remotes/origin/develop", "HEAD");
  box.git(box.repo, "switch", "-q", "-c", "feat/probe");
  mkdirSync(path.dirname(path.join(box.repo, file)), { recursive: true });
  writeFileSync(path.join(box.repo, file), "changed");
  box.git(box.repo, "add", ".");
  box.git(box.repo, "commit", "-qm", "change");
  return box.repo;
}

const session = () => {
  const s = `probe-${randomUUID()}`;
  sessions.push(s);
  return s;
};
const decision = async (cwd, command, session_id, where = cwd) => {
  const out = await runHook("guard-pr.mjs", { session_id, cwd, tool_input: { command } }, where);
  if (out) expect(out.permissionDecision).toBe("deny");
  return out?.permissionDecisionReason ?? null;
};

describe("guard-pr.mjs", () => {
  it("refuses a product branch's first pull request once with the checklist", async () => {
    const dir = branchChanging("src/a.ts");
    const id = session();
    expect(await decision(dir, OPEN, id)).toBe("Read it against the site.");
    expect(await decision(dir, OPEN, id)).toBeNull();
    expect(await decision(dir, OPEN, session())).toBe("Read it against the site.");
  });

  it("reads the branch a `cd` goes into", async () => {
    const dir = branchChanging("src/a.ts");
    expect(await decision(tmpdir(), `cd ${dir} && ${OPEN}`, session(), dir)).toBe("Read it against the site.");
  });

  it("names the delivery criterion when the branch draws, beside the checklist", async () => {
    const reason = await decision(branchChanging("ui/a.tsx"), OPEN, session());
    expect(reason).toContain("evident on first read");
    expect(reason).toContain("Read it against the site.");
    // The criterion is for what draws: a product-only diff does not carry it.
    expect(await decision(branchChanging("src/b.ts"), OPEN, session())).not.toContain("evident on first read");
  });

  it("passes a diff touching neither list, a pull request into another base, and any other command", async () => {
    const id = session();
    const docs = branchChanging("docs/a.md");
    expect(await decision(docs, OPEN, id)).toBeNull();
    const product = branchChanging("src/a.ts");
    expect(await decision(product, "gh pr create -B batch/x --title x", id)).toBeNull();
    expect(await decision(product, "gh pr view 1", id)).toBeNull();
    // Still unseen after those: the first real one refuses.
    expect(await decision(product, OPEN, id)).not.toBeNull();
  });

  it("is off when neither pr.productPaths nor surface.paths is set", async () => {
    const dir = branchChanging("src/a.ts", { branches: { integration: "develop" } });
    expect(await decision(dir, OPEN, session())).toBeNull();
  });

  it("stays silent when git cannot answer: the integration branch is no ref here", async () => {
    const dir = branchChanging("src/a.ts");
    // `develop` configured, but no origin/develop to diff against.
    boxes.at(-1).git(dir, "update-ref", "-d", "refs/remotes/origin/develop");
    expect(await decision(dir, OPEN, session())).toBeNull();
  });
});
