# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

docrank is a Claude Code **plugin** (not an npm library): guard hooks, two read-only judge agents, skills, a gates runner and a small CLI, all adapted per target repository by one file, `.claude/docrank.json`. Plain Node ESM (`.mjs`), Node ≥ 20, macOS and Linux only. **No run-time npm dependency** on the Node side (hooks, `lib/`, `scripts/`, `bin/` import Node built-ins only), and config validation is hand-written for that reason. Keep it that way. The dev dependencies are vitest, plus React, `@xyflow/react` and esbuild for the watch page, whose built bundle `ui/dist/` is committed so the plugin still runs with no install.

## Commands

```sh
npm ci                                   # install (vitest only)
npm test                                 # vitest run — the whole suite (CI: ubuntu+macos × Node 20, 24)
npm run build:ui                         # rebuild ui/dist from ui/src; commit the result (a test fails on a stale bundle)
npx vitest run hooks/guard-bash.test.mjs # one file
npx vitest run -t "a push needs the gates"   # tests whose name matches
node bin/docrank.mjs config              # resolved config of the cwd's repo, or each error + exit 1
node bin/docrank.mjs check sections      # also: check drift-pairs, judges [<range>]
claude --plugin-dir .                    # try the plugin from this checkout without installing
```

The only build is `build:ui`; there is no lint or formatter step configured.

## Architecture

- **`hooks/hooks.json`** wires every hook (`PreToolUse` on Bash/Agent/SendMessage/Edit|Write/ExitPlanMode/`mcp__.*`, `PostToolUse`, `UserPromptSubmit`, `WorktreeCreate`, `SessionStart`, `Stop`, `SessionEnd`, and the events watch records) to `node "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.mjs"`. Each hook is a standalone script reading the hook JSON on stdin.
- **Two answer styles.** `guard-bash.mjs` answers by exit code (0 allow, 2 refuse with the reason on stderr) and logs refusals to `~/.claude/blocked-commands.log`. The other PreToolUse guards answer with JSON through `lib/hook.mjs` (`decide`/`deny`); `configFor()` there turns an invalid config into a refusal, deliberately — a guard must not go quiet on a typo.
- **`lib/config.mjs` is the single owner of the config shape**: a data schema (`str`, `list`, `obj`, …) with defaults, validated by hand, all errors reported at once; defaults that depend on `branches.integration` are filled in `loadConfig`. The repo root is the git top level of `cwd`, else `CLAUDE_PROJECT_DIR`. **`docs/config.md` is the only place a key is documented** — adding/changing a key means changing both; tests read `docs/config.md` through `lib/doc-facts.mjs` and compare it with the schema.
- **`lib/agent-types.mjs`** decides what an agent type may do (read-only vs. editing, judge or not) from its frontmatter; shared by `guard-dispatch`, `guard-read-only` and `guard-recheck`. Plugin agents are `docrank:<name>` and live in `agents/`; bare types come from the target repo's `.claude/agents/`.
- **CLI**: `bin/docrank.mjs <name>` dynamically imports `lib/cli/<name>.mjs`; a subcommand is one file whose default export takes args and returns text to print (throwing → message + exit 1). Adding a command = adding a file there.
- **`scripts/`** are run by skills via `allowed-tools`: `run-gates.mjs` (runs `gates.run`, records the passing HEAD that the Bash guard and `templates/pre-push` check before a push), `watch-pr.mjs`, `prune-worktrees.mjs`, `last-report.mjs`, and `demo.mjs` (the `demo` skill: builds a bare remote, a main checkout on `main` and a worktree on `demo/tracking` from `examples/consent`, and prints the `--plugin-dir` session command per `docs/harness-facts.md` fact 16).
- **`examples/consent/`** is a tiny repository of its own (spec, module, `node --test` test, `.claude/docrank.json`) and `changes/*.patch`, the tracking change that breaks the spec and its fix. `vitest.config.mjs` excludes `examples/` so its tests are not collected as the plugin's; `scripts/demo.test.mjs` runs them through the demo.
- **`skills/`** (`init`, `gates`, `ship`, `doc-lint`, `demo`, `judge-protocol`, `dispatch-guardrails`) and **`agents/`** (`spec-arbiter`, `surface-reviewer`) are Markdown with frontmatter. `test/agents.test.mjs` asserts the agents' frontmatter (tools must stay read-only; browser tools only the page-reading ones from `.mcp.json`'s `browser` server, named `mcp__plugin_docrank_browser__<tool>`).
- **Watch** (`watch.enabled`): `hooks/watch-event.mjs` is an async, fail-open observer (always exit 0, never a decision) that appends one redacted line per hook event to `~/.claude/docrank/watch/<repo key>/<session>.jsonl` (`lib/watch/record.mjs`, `redact.mjs`); a docrank guard's refusal fires no event, so `deny()` and `guard-bash` append their own. At `SessionStart` it starts `scripts/watch-server.mjs` detached through `lib/watch/launch.mjs` (one server per machine, token + `Host` check, SSE tailing the logs). The server also applies `watch.retentionDays` and summarizes each log for the sessions list through `lib/watch/history.mjs`. `lib/watch/reduce.mjs` (events → graph, and `closing`, the summary card's figures) and `phrases.mjs` (actions → `en`/`es` sentences) are pure and shared with the page, `ui/src/main.jsx`, which esbuild (`ui/build.mjs`) bundles into the committed `ui/dist/`; its timeline is `reduce` over a prefix of the lines, no second reducer.
- **`principles/principles.md`** is injected at session start by `hooks/principles.mjs`.

## Tests

Tests sit next to their source (`foo.mjs` → `foo.test.mjs`) and run hooks as real child processes, the way Claude Code does:

- `lib/testing.mjs` — `project(files)` makes a temp dir; `runHook` / `runExit` / `runJson` run a hook for the JSON-style, exit-code-style and non-`hookSpecificOutput` hooks respectively.
- `test/cases-runner.mjs` — builds a sandbox git repo plus a worktree, a sandbox `HOME`, and puts `test/stubs/gh` first on `PATH` (it answers fixed PR bases: 1→`main`, 2→`develop`, 3, 4, and env-driven `pr checks`/`pr list`). Bash-guard behaviour is mostly specified as `test/cases/*.cases` tables: optional `CONFIG|{json}`, then `BLOCK|<cmd>` / `ALLOW|@<branch>|<cmd>` / `ALLOW|@wt:<branch>|<cmd>` lines. Add a guard rule by adding lines there.

## Documents

- `docs/config.md` — every key, once, with its default.
- `docs/docs-as-spec.md` — the section/drift-pair checks, the `doc-facts` readers, how the judges read config.
- `docs/harness-facts.md` — each Claude Code behaviour the plugin relies on, VERIFIED (with a source quote) or NOT DOCUMENTED, plus what was proved in live trials (§ 15). Consult it before relying on a harness behaviour, and record any new dependency there rather than from memory.
- The README's guard table and "what is proved live" section must stay true when a guard or its status changes.

## Conventions

- Prose in code comments and docs is terse declarative English; module headers explain *why* (see `guard-bash.mjs`, `config.mjs`).
- Commits: conventional style with a scope, e.g. `feat(hooks): …`, `docs: …`, `chore: …`; work lands through pull requests into `main`.
