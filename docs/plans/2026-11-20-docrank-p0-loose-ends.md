# docrank P0 — loose ends

The P0 plan closed with five things left open. This plan closes them; nothing
else is in scope (the closing-line rule and the memory link, unproved since
before P0, go to P1).

- [x] **1 · `init` pairs a named file's directory for doc drift.** In the live
  trial `init` proposed `docDrift.entries` with the literal `src/checkout.mjs`,
  so a file added beside it would not be paired. The skill now pairs the
  file's directory (`src/`), as it already does for the ground.
- [x] **2 · Release 0.2.1** with that change and the demo's step output
  (`6154775`), which `main` holds but 0.2.0 does not. PR, CI green, merge and
  tag `docrank--v0.2.1` with its GitHub release.
- [x] **3 · One live trial of 0.2.1** (user, interactive), from the
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
- [ ] **3b · `init` reads absence without an error.** The 0.2.1 trial proved
  both wording changes, and showed four errors, each a probe of something
  absent: `git symbolic-ref refs/remotes/origin/HEAD` (128, which the skill
  prescribed), a Read of an absent `.claude/docrank.json` and of an absent
  `.git/hooks/pre-push`, and `git config --get core.hooksPath` unset (1). The
  skill now reads absence from a Glob or a listing: `git branch --all` for the
  remote's default, Glob before a Read, `git status --short --ignored` for
  ignored env files, `git rev-parse --git-path hooks` for the hooks directory.
  Release 0.2.2 and rerun the `init` trial.
- [ ] **4 · Record** the trial in `docs/harness-facts.md` § 15, fact 16 and the
  README «What is proved live»; this plan leaves the tree in the same PR.
