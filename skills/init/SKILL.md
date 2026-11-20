---
name: init
description: Read this repository (branches, package manager, scripts, formatter, docs tree, ignored env files) and propose a complete `.claude/docrank.json` for the user to confirm, then write it, prove it loads, and offer the optional git pre-push hook. Use when adopting docrank in a repository, or to revisit its configuration.
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/docrank.mjs *) Bash(git branch *) Bash(git remote *) Bash(git symbolic-ref *) Bash(git ls-files *) Bash(git check-ignore *) Bash(git rev-parse *) Read Grep Glob
---

Propose `.claude/docrank.json` for this repository. Every key and default is in
`${CLAUDE_PLUGIN_ROOT}/docs/config.md`; read it first. The file is the only
thing docrank asks of a repository, and a key left out keeps its default, so
write a key only where the repository differs from the default or the key turns
a feature on. Read; write nothing until step 3.

## 1. Read the repository

Each finding is something the repository shows. Where it shows nothing, the
key stays out and the proposal says so; never guess.

- **Branches.** `git branch --all`, `git remote -v`,
  `git symbolic-ref refs/remotes/origin/HEAD`. The integration branch is the
  one work branches from and merges back into: `develop` or `trunk` beside
  `main` means that one; a repository with only `main` has integration `main`
  and protected `main`. `branches.protected` holds the released line, plus the
  integration branch when it is not the same. Add `branches.integration` only
  when it is not `main`.
- **Package manager.** From the lockfile: `pnpm-lock.yaml`, `yarn.lock`,
  `package-lock.json`, `bun.lockb` or `bun.lock`, else `Cargo.lock`,
  `poetry.lock`, `go.sum`. Read `package.json` `scripts` (or the `Makefile`,
  `pyproject.toml`, `Cargo.toml` equivalent) with the Read tool.
- **Gates.** `gates.run` is the repository's own checks, cheapest first so a
  push waits on the failure soonest: format or token check, lint, typecheck,
  test, build. Only scripts that exist, each as the manager runs it
  (`pnpm lint`, `npm run typecheck`). A browser, database or deploy script goes
  to `gates.jobs`, which runs only when named. No such scripts: leave `gates`
  out and say that pushes are then unchecked.
- **Format.** `format.command` from the formatter the repository configures
  (a Prettier, Biome, `ruff format`, `gofmt` config), as a command that takes
  the file path appended; `format.lintCommand` and `format.lintExtensions` from
  its linter the same way. None configured: leave them out.
- **Docs.** `Glob` for `docs/`, `doc/`, a root `DESIGN.md`, `ARCHITECTURE.md`,
  `CLAUDE.md`. Suggest `docs.precedence` only when a document states its own
  rank over others; otherwise leave it empty and say so. Suggest
  `docDrift.entries` only for a pairing the repository states (a doc that
  names the directory it describes); `docs.scanRoots` as `["docs"]` when
  documents cite each other by `§` headings. Empty when unsure: an empty key is
  an off feature, a wrong one is noise on every stop.
- **Worktree files.** `.env*` (and `.mcp.json`) that exist but are git-ignored
  (`git check-ignore`), because a worktree does not carry them: `worktree.copy`.
  The default is `[".env", ".mcp.json"]`, so write the key only for a different
  set. `worktree.install` from the package manager's install command, when the
  repository has dependencies.
- **Existing setup.** An existing `.claude/docrank.json` is read first and its
  keys kept; a `CLAUDE.md` is read for rules a key can state (a banned
  command is a `guard.extraDeny`, a file nobody edits a `paths.rules`).

## 2. Propose

Show the whole file as JSON with, beside each key that is not a default, one
line of reason ("lockfile is pnpm-lock.yaml", "only `main` exists"). Then list
the keys that stay at their default and the features that stay off because the
repository showed nothing, so the user sees what is not guarded.

Where a choice is the user's (which scripts are gates, which branch is
integration when two fit, whether `format.command` runs on every edit), ask with
`AskUserQuestion`: one question at a time, 2 to 4 concrete options, the one you
judge best first and marked "(Recommended)" with its reason, "Other" taking the
user's words. Decide what the repository settles; ask only what it does not.

## 3. Write, after a yes

Nothing is written before the user confirms the proposal.

1. If `.claude/docrank.json` exists, show the diff against the proposal and ask
   before replacing it. Never overwrite it unseen.
2. Write the file.
3. Prove it: `node ${CLAUDE_PLUGIN_ROOT}/bin/docrank.mjs config` prints the
   resolved config, or one error per problem naming the key and exits 1; fix
   and run again until it prints. Where `docs.scanRoots` or `docs.unitRoots` is
   set, also run `docrank check sections` or `docrank check drift-pairs` and
   report what they find, without editing the documents.
4. Say what is now guarded and what is not, from `docs/config.md`.

## 4. Optional, each on its own yes

Offer these separately, and only when the repository gains from it. A no, or no
answer, leaves the repository as step 3 left it.

- **The pre-push hook** (`${CLAUDE_PLUGIN_ROOT}/templates/pre-push`). Inside
  Claude Code the Bash guard already refuses a push whose commit has not
  passed the gates; the hook gives a push from a terminal the same check. Only
  when `gates.run` is set. Install it as `.githooks/pre-push` (executable) with
  `git config core.hooksPath .githooks`, or into `.git/hooks/pre-push` when the
  repository has no hooks directory of its own; never over an existing hook
  without showing it. Say that `git push --no-verify` is the way past it.
- **Fallback hooks.** For an event whose plugin hook does not act, and only
  that event: never one whose plugin hook acts, since the plugin's hook and
  the copy could both fire, and that Claude Code runs such a pair once is not
  documented. Facts 2 and 3 of `${CLAUDE_PLUGIN_ROOT}/docs/harness-facts.md`
  hold what is known of each:
  - `WorktreeCreate` (fact 2: VERIFIED, with two limits; PROVED LIVE): a
    plugin's hook does not run for the worktree of a session launched with
    `--worktree --tmux`, nor, before Claude Code 2.1.300, with `--worktree`
    alone. Offer it only when the user's Claude Code is older than 2.1.300
    (`claude --version`) or they launch with `--worktree --tmux`.
  - `Stop` (fact 3: NOT DOCUMENTED per event; `Stop` PROVED LIVE): no page
    lists the events a plugin may register, and a plugin's `Stop` hook was
    seen to act live. Offer it only when the user says doc drift or the
    hand-off does not act.

  It writes the entries of `${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json` for that
  event into `.claude/settings.local.json`, uncommitted, with this plugin's
  absolute path, `${CLAUDE_PLUGIN_ROOT}`, in place of the variable, which a
  settings file does not expand.
