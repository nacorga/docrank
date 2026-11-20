# docrank P0 — loose ends

The P0 plan closed with five things left open. This plan closes them; nothing
else is in scope (the closing-line rule and the memory link, unproved since
before P0, go to P1).

- [ ] **1 · `init` pairs a named file's directory for doc drift.** In the live
  trial `init` proposed `docDrift.entries` with the literal `src/checkout.mjs`,
  so a file added beside it would not be paired. The skill now pairs the
  file's directory (`src/`), as it already does for the ground.
- [ ] **2 · Release 0.2.1** with that change and the demo's step output
  (`6154775`), which `main` holds but 0.2.0 does not. PR, CI green, merge and
  tag `docrank--v0.2.1` with its GitHub release.
- [ ] **3 · One live trial of 0.2.1** (user, interactive), from the
  marketplace install of the 0.2.0 trial:
  - `claude plugin update docrank@docrank` reaches 0.2.1;
  - `/docrank:demo` prints the steps apart from what to expect, and the three
    steps, typed alone, give the same finding and its clean re-check;
  - fact 16's unproved half: the worktree is given a `.claude/docrank.json`
    the main checkout does not have (uncommitted `docDrift.entries` pairing
    `src/` with `docs/spec.md`); doc drift firing on `Stop` in a session
    started in the worktree proves a hook reads the config of its launch
    directory;
  - `/docrank:init` in a copy of `examples/consent` with no `.claude/` and no
    rank sentence: reads with Read and Glob and one unchained command per Bash
    call, offers `src/**` ahead of `src/checkout.mjs` for the ground, and
    pairs `src/` for doc drift.
- [ ] **4 · Record** the trial in `docs/harness-facts.md` § 15, fact 16 and the
  README «What is proved live»; this plan leaves the tree in the same PR.
