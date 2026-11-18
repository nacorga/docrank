# docrank

A Claude Code plugin that enforces a working method instead of asking for it.
Guard hooks refuse what cannot be taken back; read-only judges review a change
against the repository's documents; the repository's gates must pass before a
push; documents outrank code when the two disagree; a short set of working
principles starts every session. One file per repository,
`.claude/docrank.json`, adapts all of it, and the `init` skill proposes that
file by reading the repository.

## Install

```
/plugin marketplace add nacorga/docrank
/plugin install docrank@docrank
```

On Claude Code 2.1.275 or later, one step: `/plugin install docrank --marketplace nacorga/docrank`.

To try it from a checkout without installing: `claude --plugin-dir <path to this repository>`.

## Quick start

In the repository you want to guard, run `/docrank:init`. It reads the
branches, the package manager, the scripts, the formatter and the docs tree,
proposes a complete `.claude/docrank.json` with a reason for each key it sets,
and writes nothing until you confirm. Without that file every guard runs on its
defaults and the features that need a setting stay off.

## What each guard refuses

Every key is documented once, with its default, in [docs/config.md](docs/config.md).

| Guard | Refuses | Key |
|---|---|---|
| Bash | `git reset --hard`, `git clean -fd`, `git checkout .`, force pushes, `git push --no-verify`, `rm -rf` of a root, the current directory or home | always on |
| Bash | a push naming a protected branch, a bare push or `git merge` while on one, `gh pr merge --admin`, a merge into a protected branch or a base not in the allowed list | `branches.*` |
| Bash | a push of a commit whose gates have not passed | `gates.requireBeforePush`, `gates.run` |
| Bash | pushing tags that match a pattern, `--tags`, `--follow-tags` | `guard.blockedTagPatterns` |
| Bash | `npm publish`, `pnpm publish` | `guard.publishBan` |
| Bash | moving the main checkout off the integration branch, deleting an unmerged branch | `branches.integration` |
| Bash | any command that matches a pattern the repository adds | `guard.extraDeny` |
| Bash | a write or a command that runs, from a read-only agent | `judges.skill` |
| Agent | a fork dispatch; an Opus dispatch with no `Heavy:` line; completes a dispatch with the guardrails block, and sets the default model and effort | `dispatch.*` |
| SendMessage | a message to a judge past its re-check limit, once | `judges.maxRechecks` |
| Edit, Write | `.env*` except `.env.example`, lockfiles, and the repository's own rules | `paths.builtIns`, `paths.rules` |
| ExitPlanMode | a plan without a required heading | `plan.requiredHeadings` |
| `gh pr create` | the first one of a branch whose diff touches product or surface paths, once, with the handover checklist | `pr.*`, `surface.paths` |
| MCP tools | the first send of a message through a configured tool, once, with a claims checklist | `messages.*` |

Around them, not refusing: the formatter and linter run on each edited file
(`format.*`), a question at the end of a session whose code changes a document
did not follow (`docDrift.*`), a worktree cut from the fetched integration
branch with the repository's ignored files copied in (`worktree.*`), the working
principles at session start (`principles.*`), a hand-off request when the
context grows past a threshold (`handoff.*`), and an optional link between
Claude Code's memory and the repository's tracked `.claude/memory` (`memory.link`).

An invalid `.claude/docrank.json` refuses every guarded call and names each
problem. A guard stops accidents, not a determined attempt: every Bash
refusal is also logged to `~/.claude/blocked-commands.log`.

## Skills, agents and the CLI

Skills: `init` (propose the configuration), `gates` (run `gates.run` in order,
PASS or FAIL each, and record the commit that passed), `ship` (one piece of
work from worktree to a green pull request; the merge stays yours),
`doc-lint` (sweep the documents for what no test catches),
`judge-protocol` and `dispatch-guardrails` (loaded by agents and dispatches).

Agents, both read-only: `spec-arbiter` (a diff against the documents by
`docs.precedence`; labels each disagreement a code defect or a doc defect) and
`surface-reviewer` (opens the rendered pages in a headless Chrome, which the
plugin starts through `chrome-devtools-mcp`, at `surface.widths`).

The CLI is `node <plugin>/bin/docrank.mjs <command>`:

- `config` prints the resolved configuration, or each error and exit 1.
- `check sections` and `check drift-pairs` hold the documents to their
  references and to a pair for every code unit (`docs.scanRoots`, `docs.unitRoots`).
- `judges [<range>]` names the judges a diff needs (`judges.routes`).

`templates/pre-push` is an optional git hook with the same gates check, for
pushes made outside Claude Code; `init` offers it.

## Requirements

Node 20 or later, git, and `gh` for the pull request features. macOS and Linux;
Windows is not supported. The plugin has no run-time npm dependency, and the
browser server of `surface-reviewer` needs `npx` and Chrome.

## What is proved live, and what is not

Trial runs of the installed plugin in two real repositories proved the Bash
guard, the gates and their record before a push, format and lint on edit, the
session-start principles, a judge review and its re-check count, doc drift on
`Stop`, `WorktreeCreate` and the browser server
([docs/harness-facts.md](docs/harness-facts.md) § 15). Not yet exercised live,
though tested on stubbed input: `guard-message`, `guard-pr`, `guard-plan`,
`context-handoff`, the memory link (off by default, its directory rule
undocumented), and whether a judge's `skills: docrank:judge-protocol`
preloads the skill.

## License

MIT.
