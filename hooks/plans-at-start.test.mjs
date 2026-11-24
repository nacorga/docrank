import { describe, expect, it } from "vitest";
import { project, runHook } from "../lib/testing.mjs";

const on = (extra = {}) => JSON.stringify({ plans: { atStart: true }, ...extra });
const run = (files, source = "startup") => runHook("plans-at-start.mjs", { hook_event_name: "SessionStart", source }, project(files));

const half = "# A\n\n- [x] one\n- [ ] two\n  - [X] nested\n* [ ] three\n";
const withHandoff = "# B\n\n- [x] done\n\n## Handoff\n\nWhere it stopped.\n";

describe("plans-at-start.mjs", () => {
  it("lists each plan by name with checked over total, and its hand-off when it has one", async () => {
    const out = await run({
      ".claude/docrank.json": on(),
      "docs/plans/b.md": withHandoff,
      "docs/plans/a.md": half,
      "docs/plans/notes.txt": "- [ ] not a plan",
    });
    expect(out).toEqual({
      hookEventName: "SessionStart",
      additionalContext: "Plans in progress:\n- `docs/plans/a.md` · 2/4\n- `docs/plans/b.md` · 1/1 · § Handoff",
    });
  });

  it("reads the directory ship.plansDir names, and says when a plan has no checklist", async () => {
    const out = await run({ ".claude/docrank.json": on({ ship: { plansDir: "work/plans" } }), "work/plans/c.md": "# C\n\nProse.\n" });
    expect(out.additionalContext).toBe("Plans in progress:\n- `work/plans/c.md` · no checklist");
  });

  it("counts no box and no heading inside a fenced code block, and skips the directory's README", async () => {
    const fenced = "# D\n\n- [x] real\n\n```md\n- [ ] example\n## Handoff\n```\n\n~~~~\n- [x] also an example\n~~~~\n- [ ] real too\n";
    const out = await run({ ".claude/docrank.json": on(), "docs/plans/d.md": fenced, "docs/plans/README.md": "- [ ] how to write one\n" });
    expect(out.additionalContext).toBe("Plans in progress:\n- `docs/plans/d.md` · 1/2");
  });

  it("lists them again after a compaction", async () => {
    const files = { ".claude/docrank.json": on(), "docs/plans/a.md": half };
    expect((await run(files, "compact")).additionalContext).toContain("`docs/plans/a.md` · 2/4");
  });

  it("is silent while off, with no plans directory, and on an invalid config", async () => {
    expect(await run({ "docs/plans/a.md": half })).toBeNull();
    expect(await run({ ".claude/docrank.json": on() })).toBeNull();
    expect(await run({ ".claude/docrank.json": JSON.stringify({ plans: { atStart: "yes" } }), "docs/plans/a.md": half })).toBeNull();
  });
});
