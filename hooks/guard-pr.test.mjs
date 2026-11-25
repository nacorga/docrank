import { execFileSync } from "node:child_process";
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
  sessions.splice(0).forEach((s) => rmSync(path.join(tmpdir(), `stickler-pr-handover-${s}`), { force: true }));
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

  it("answers in full, parsed whole, when the answer is far over a pipe's buffer (64 KB and more)", async () => {
    const checklist = "long checklist ".repeat(20000);
    const dir = branchChanging("src/a.ts", { ...config, pr: { ...config.pr, checklist } });
    const reason = await decision(dir, OPEN, session());
    expect(checklist.length).toBeGreaterThan(256 * 1024);
    expect(reason).toBe(checklist);
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

  describe("with pr.requiredLines", () => {
    const evidence = { ...config, pr: { ...config.pr, requiredLines: ["^Commercial reading: \\S", "^Gates: passed$"] } };
    const BODY = "Commercial reading: nothing sold\nGates: passed";
    const open = (flags) => `gh pr create --base develop --title x ${flags}`;

    it("passes a body that carries every line, from --body, -b, --body-file or -F, the first time", async () => {
      const dir = branchChanging("src/a.ts", evidence);
      writeFileSync(path.join(dir, "body.md"), `Summary\n${BODY}\n`);
      expect(await decision(dir, open(`--body "${BODY}"`), session())).toBeNull();
      expect(await decision(dir, open(`-b '${BODY}'`), session())).toBeNull();
      expect(await decision(dir, open(`--body="$(cat <<'EOF'\n${BODY}\nEOF\n)"`), session())).toBeNull();
      expect(await decision(dir, open("--body-file body.md"), session())).toBeNull();
      expect(await decision(dir, open("-F body.md"), session())).toBeNull();
      expect(await decision(tmpdir(), `cd ${dir} && ${open("-F body.md")}`, session(), dir)).toBeNull();
    });

    it("reads a heredoc body whose prose holds quotes, an apostrophe and an unbalanced paren", async () => {
      const dir = branchChanging("src/a.ts", evidence);
      const prose = 'The "gates" passed; it\'s a 5" fix (really) & 1) item';
      const heredoc = (lines, opener = "<<'EOF'", end = "EOF") => open(`--body "$(cat ${opener}\n${prose}\n${lines}\n${end}\n)"`);
      for (const opener of ["<<'EOF'", "<<EOF", '<<"EOF"', "<<-EOF"]) {
        expect(await decision(dir, heredoc(BODY, opener), session())).toBeNull();
      }
      expect(await decision(dir, `${heredoc(BODY)} && echo done`, session())).toBeNull();
      const reason = await decision(dir, heredoc("Commercial reading: nothing sold"), session());
      expect(reason).toContain("/^Gates: passed$/");
      expect(reason).not.toContain("Commercial reading: \\S");
    });

    it("reads the body whole when it holds a `;`, an `&` or a `|`", async () => {
      const dir = branchChanging("src/a.ts", evidence);
      expect(await decision(dir, open(`--body "a; b & c | d\n${BODY}"`), session())).toBeNull();
    });

    it("refuses a body that lacks a line, naming it, every time and not once", async () => {
      const dir = branchChanging("src/a.ts", evidence);
      const id = session();
      const command = open(`--body "Commercial reading: nothing sold"`);
      for (let attempt = 0; attempt < 3; attempt++) {
        const reason = await decision(dir, command, id);
        expect(reason).toContain("/^Gates: passed$/");
        expect(reason).not.toContain("Commercial reading: \\S");
        expect(reason).toContain("Read it against the site.");
      }
    });

    it("matches a line case-insensitively and ignores a line that only holds the text inside another", async () => {
      const dir = branchChanging("src/a.ts", evidence);
      expect(await decision(dir, open(`--body "commercial READING: x\ngates: PASSED"`), session())).toBeNull();
      expect(await decision(dir, open(`--body "Commercial reading: x\nGates: passed, almost"`), session())).toContain("Gates");
    });

    it("counts --fill, no body, stdin and a missing file as no body", async () => {
      const dir = branchChanging("src/a.ts", evidence);
      for (const flags of ["--fill", "", "--body-file -", "-F nowhere.md"]) {
        expect(await decision(dir, open(flags), session())).toContain("not in the command");
      }
    });

    it("owes a line with paths only to a diff that touches one of them", async () => {
      const scoped = {
        ...config,
        pr: { ...config.pr, requiredLines: ["^Gates: passed$", { pattern: "^Surface review: done$", paths: ["ui/"] }] },
      };
      const bare = `--body "Gates: passed"`;
      const both = `--body "Gates: passed\nSurface review: done"`;
      // A product diff outside the paths owes only the bare line.
      expect(await decision(branchChanging("src/a.ts", scoped), open(bare), session())).toBeNull();
      // A diff inside them owes both, and names the one missing.
      const drawing = branchChanging("ui/a.tsx", scoped);
      expect(await decision(drawing, open(bare), session())).toContain("/^Surface review: done$/");
      expect(await decision(drawing, open(both), session())).toBeNull();
    });

    it("falls back to the once-per-branch checklist when the diff is product but no entry is owed", async () => {
      const scopedOnly = {
        ...config,
        pr: { ...config.pr, requiredLines: [{ pattern: "^Surface review: done$", paths: ["ui/"] }] },
      };
      const dir = branchChanging("src/a.ts", scopedOnly);
      const id = session();
      expect(await decision(dir, open(`--body "x"`), id)).toBe("Read it against the site.");
      expect(await decision(dir, open(`--body "x"`), id)).toBeNull();
    });

    it("reads a diff that touches only an entry's paths, with neither list set", async () => {
      const only = { branches: { integration: "develop" }, pr: { requiredLines: [{ pattern: "^Surface review: done$", paths: ["ui/"] }] } };
      const dir = branchChanging("ui/a.tsx", only);
      expect(await decision(dir, open(`--body "x"`), session())).toContain("/^Surface review: done$/");
      expect(await decision(dir, open(`--body "Surface review: done"`), session())).toBeNull();
      expect(await decision(branchChanging("docs/a.md", only), open("--fill"), session())).toBeNull();
    });

    it("still leaves a diff that touches neither list, and another base, alone", async () => {
      expect(await decision(branchChanging("docs/a.md", evidence), open("--fill"), session())).toBeNull();
      expect(await decision(branchChanging("src/a.ts", evidence), "gh pr create -B batch/x --fill", session())).toBeNull();
    });
  });

  describe("a pull request into a shared base", () => {
    const baseConfig = { branches: { integration: "main", allowedPrBases: ["main", "batch/*"], baseFreshHours: 24 } };
    const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

    /**
     * A repository with a bare origin whose `main` holds one commit that
     * `batch/x` lacks, committed `hours` ago; `behind` further commits sit on
     * top of it, newer. The probe runs on the checkout, off `main`.
     */
    function withOrigin(hours, cfg = baseConfig, newer = 0) {
      const box = sandbox({ config: cfg });
      boxes.push(box);
      const origin = path.join(box.dir, "origin.git");
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
      box.git(box.repo, "remote", "add", "origin", origin);
      box.git(box.repo, "branch", "batch/x");
      const commit = (name, when) => {
        writeFileSync(path.join(box.repo, name), name);
        box.git(box.repo, "add", name);
        execFileSync("git", ["-C", box.repo, "commit", "-qm", name], { env: { ...process.env, GIT_COMMITTER_DATE: when } });
      };
      commit("late.txt", hoursAgo(hours));
      for (let i = 0; i < newer; i++) commit(`newer-${i}.txt`, hoursAgo(0.5));
      box.git(box.repo, "push", "-q", "origin", "main", "batch/x");
      box.git(box.repo, "switch", "-q", "-c", "slice");
      return box.repo;
    }
    const open = (base) => `gh pr create --base ${base} --title x --body y`;

    it("is refused when the integration branch's oldest commit the base lacks is older than baseFreshHours", async () => {
      const dir = withOrigin(25, baseConfig, 2);
      const reason = await decision(dir, open("batch/x"), session());
      expect(reason).toContain("Merge main into batch/x first");
      expect(reason).toContain("by a merge and not a rebase");
    });

    it("goes through when that commit is younger, off, or the base is no shared base", async () => {
      const id = session();
      expect(await decision(withOrigin(23), open("batch/x"), id)).toBeNull();
      expect(await decision(withOrigin(25, { branches: { ...baseConfig.branches, baseFreshHours: undefined } }), open("batch/x"), id)).toBeNull();
      const dir = withOrigin(25);
      expect(await decision(dir, open("release/y"), id)).toBeNull();
      expect(await decision(dir, "gh pr create --title x --body y", id)).toBeNull();
    });

    it("goes through when git cannot answer", async () => {
      const dir = withOrigin(25);
      execFileSync("git", ["-C", dir, "remote", "set-url", "origin", path.join(dir, "gone.git")]);
      expect(await decision(dir, open("batch/x"), session())).toBeNull();
      expect(await decision(dir, open("batch/absent"), session())).toBeNull();
    });
  });
});
