---
name: init
description: Read this repository (branches, package manager, scripts, formatter, docs tree, ignored env files) and propose a complete `.claude/docrank.json` for the user to confirm, then write it, prove it loads, and offer the optional git pre-push hook and, with watch on, the task tools' variable. Use when adopting docrank in a repository, or to revisit its configuration.
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/docrank.mjs *) Bash(git branch *) Bash(git remote *) Bash(git ls-files *) Bash(git status *) Bash(git rev-parse *) Read Grep Glob
---

Propose `.claude/docrank.json` for this repository. Every key and default is in
`${CLAUDE_PLUGIN_ROOT}/docs/config.md`; read it first. The file is the only
thing docrank asks of a repository, and a key left out keeps its default, so
write a key only where the repository differs from the default or the key turns
a feature on. Read; write nothing until step 3. Files are read with Read and
found with Glob; Bash runs only the git and docrank commands of
`allowed-tools`, one per call, never chained. Absence is read from a Glob or
a listing, never from an error: a file that may be missing is found with Glob
before it is read, and no command is run that fails when what it asks about is
not there.

## 1. Read the repository

Each finding is something the repository shows or the user answers. Where
neither settles a key, it stays out and the proposal says so; never guess.

- **Branches.** `git branch --all`, whose `remotes/origin/HEAD -> origin/<name>`
  line, when there is one, names the remote's default, and `git remote -v`.
  The integration branch is the
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
- **Docs.** `Glob` for `docs/`, `doc/`, ADR directories (`adr/`,
  `docs/adr/`, `docs/decisions/`), a root `DESIGN.md`, `ARCHITECTURE.md`,
  `CLAUDE.md`: these are the candidate documents. Suggest `docDrift.entries`
  only for a pairing the repository states (a doc that names the directory it
  describes; a doc that names a file pairs that file's directory, `src/` for
  `src/checkout.mjs`, so a file added beside it is paired too);
  `docs.scanRoots` as `["docs"]` when documents cite each other by
  `§` headings. Empty when unsure: an empty key is an off feature, a wrong one
  is noise on every stop.
- **Spec arbiter.** `docrank:spec-arbiter` judges a diff against the
  documents of `docs.precedence`, and `docrank judges`, which the ship skill
  follows, names it for a diff only through `judges.routes`; either empty, it
  is off. Settle the document first:
  - A candidate that states a rank, its own or another's ("this document
    binds", one document outranking another), gives `docs.precedence` in the
    order stated, the quoted line its reason.
  - Otherwise ask which candidate binds, by the rules of step 2: the likeliest
    three as options, a spec before a readme, and `None` always one of them.
  - No candidate, or `None`: both keys stay out, and the proposal says the
    repository keeps gates and guards only.

  With a document settled, ask next what code it governs: `["**"]`, every
  change, unless the document names the code it covers, whose globs
  (`src/**`) then lead. A named file puts the glob of its directory
  (`src/**` for `src/checkout.mjs`) among the options ahead of the file
  itself, so a file added beside it is not left unjudged; the user still
  chooses. Propose the two keys together:
  `docs.precedence`, `["<doc>"]` for a chosen document, and
  `judges.routes: [{ "agent": "docrank:spec-arbiter", "ground": [<globs>] }]`,
  the ground `["**"]` when the user narrows nothing. Neither is inferred: a
  stated rank is proposed for the user's yes, and anything else is asked.
- **Worktree files.** `.env*` (and `.mcp.json`) that exist but are git-ignored
  (`git status --short --ignored -- <paths>` marks them `!!`), because a
  worktree does not carry them: `worktree.copy`.
  The default is `[".env", ".mcp.json"]`, so write the key only for a different
  set. `worktree.install` from the package manager's install command, when the
  repository has dependencies.
- **Watch.** `watch.enabled` turns on the live view of a session in a
  browser tab; nothing in a repository says whether its user wants one, so
  ask, with the value of an existing `.claude/docrank.json` as the first
  option when it has one. Off: the key stays out.
- **Existing setup.** An existing `.claude/docrank.json` is read first and its
  keys kept; a `CLAUDE.md` is read for rules a key can state (a banned
  command is a `guard.extraDeny`, a file nobody edits a `paths.rules`).

## 2. Propose

Show the whole file as JSON with, beside each key that is not a default, one
line of reason ("lockfile is pnpm-lock.yaml", "only `main` exists"). Then list
the keys that stay at their default and the features that stay off because the
repository showed nothing, so the user sees what is not guarded. Say whether
the spec arbiter is on, with its document and ground, or off and why: no
candidate document, or the user chose none.

Where a choice is the user's (which scripts are gates, which branch is
integration when two fit, whether `format.command` runs on every edit, which
document binds and what code it governs), ask with
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
   report what they find, without editing the documents. Where
   `judges.routes` is set, also run
   `node ${CLAUDE_PLUGIN_ROOT}/bin/docrank.mjs judges` and report the judge it
   names. It reads the working tree too, so the file just written is a change:
   a ground that covers `.claude/docrank.json` shows the judge as `launch`,
   one that does not as `skip`, and both prove the route, as does
   `Nothing changed` on a tree with no change since the fork. It exits 1 when
   neither `origin/<integration>` nor `<integration>` is a commit here, as in a
   repository with no commit yet: say so, `config` has already proved the
   route, and `judges` names the judge once that branch has a commit.
4. Say what is now guarded and what is not, from `docs/config.md`, and whether
   the spec arbiter is on: the judge `judges` named and its ground, or off and
   why.

## 4. Optional, each on its own yes

Offer these separately, and only when the repository gains from it. A no, or no
answer, leaves the repository as step 3 left it.

- **The pre-push hook** (`${CLAUDE_PLUGIN_ROOT}/templates/pre-push`). Inside
  Claude Code the Bash guard already refuses a push whose commit has not
  passed the gates; the hook gives a push from a terminal the same check. Only
  when `gates.run` is set. Install it as `.githooks/pre-push` (executable) with
  `git config core.hooksPath .githooks`, or into `.git/hooks/pre-push` when the
  repository has no hooks directory of its own; `git rev-parse --git-path
  hooks` names the directory git runs hooks from, `core.hooksPath` honoured.
  Never over an existing hook without showing it. Say that
  `git push --no-verify` is the way past it.
- **The task list for watch.** Only when the file written turns
  `watch.enabled` on. Watch draws a session's tasks from Claude Code's task
  tools, which newer models lack unless `CLAUDE_CODE_ENABLE_TODO_TOOLS` is
  `1` (fact 22 of `${CLAUDE_PLUGIN_ROOT}/docs/harness-facts.md`); without
  them watch groups the work by turn. Offer to add
  `"env": { "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" }` to the repository's
  `.claude/settings.json`, which is checked in, so it applies to everyone
  working in the repository. Find the file with Glob first; when it exists,
  read it and propose it whole with the one entry added, every other key and
  `env` entry kept, and say so when it already sets the variable, offering
  nothing. Write only after a yes. Say, from fact 25, that a repository's
  `env` applies once the folder is trusted, that the task tools following it
  from that file is not documented nor proved, that it needs Claude Code
  2.1.233 or later and takes effect from the next session started in the
  repository, and that exporting the variable before `claude` is the
  documented way.
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
