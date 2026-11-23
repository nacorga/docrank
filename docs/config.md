# Configuration

One file per repository, `.claude/docrank.json`, read through `lib/config.mjs`.
This page is the only place a key is documented; the loader is the only place
its shape is defined. The file may be absent: every key then has its default.

A key with no default (`null` below, or an empty list) is optional, and the
feature that reads it stays off until it is set. An unknown key, a value of the
wrong type or a regular expression that does not compile refuses the whole file,
with one message per problem naming the key path and what was expected.

Types: a *path prefix* is matched against repository-relative paths with
`startsWith`; a *glob* is a `*`/`**` pattern; a *regex* is a JavaScript regular
expression source, compiled with the `u` flag. Every string is non-empty.

Defaults that depend on `branches.integration` are written `<integration>`.

## `branches`

| Key | Type | Default | Read by |
|---|---|---|---|
| `branches.protected` | string[] | `["main", "master"]` | Bash guard: refuses a push naming one, a bare push or a `git merge` while on one, any `gh pr merge` or `gh api` merge into one, whatever `allowedPrBases` says, and is a base `gh pr create` may name. Exact names, no globs |
| `branches.integration` | string | `"main"` | Bash guard (the main checkout stays on it; a push of a commit `origin/<integration>` holds needs no gates record), worktrees (cut from the fetched `origin/<integration>`), `docrank judges` (the fork point), the PR handover guard, doc drift and `pr` defaults |
| `branches.allowedPrBases` | glob[] | `[<integration>]` | Bash guard: `gh pr merge` is allowed only for a pull request whose base matches and is not protected (GitHub is asked; `--admin` never), and `gh pr create` or `edit` may name a protected branch or one of these as base. `[]` leaves every merge to the user |

## `guard`

| Key | Type | Default | Read by |
|---|---|---|---|
| `guard.blockedTagPatterns` | regex[] | `[]` | Bash guard: a push of a tag whose name matches one is refused (`refs/tags/<name>`, or a name that is a local tag), and so are `--tags` and `--follow-tags`, which carry tags unnamed. Empty means tags are not checked |
| `guard.publishBan` | boolean | `true` | Bash guard: refuses `npm publish` and `pnpm publish` |
| `guard.extraDeny` | `{pattern: regex, reason: string}[]` | `[]` | Bash guard: a command matching `pattern` is refused with `reason`. The pattern is tried against the whole command string, so anchor it to a command position if prose that merely quotes the command must pass |

## `gates`

| Key | Type | Default | Read by |
|---|---|---|---|
| `gates.run` | `{name: string, command: string}[]` | `[]` | gates skill and runner: run in order, stop at the first failure; names are unique. Empty means no gates |
| `gates.jobs` | map of name to command | `{}` | gates runner: run only when named, after the gates; named alone they run without them |
| `gates.requireBeforePush` | boolean | `true` | Bash guard: a push is refused unless the tip of each ref it pushes is listed in the record or is an ancestor of `origin/<integration>`; tags, deletions and dry runs are not checked; moot while `gates.run` is empty |
| `gates.record` | string | `"docrank-gates-passed"` | gates runner, Bash guard and the optional `templates/pre-push`: file name, in the git common directory, holding one commit sha per line, each a HEAD that passed; the runner writes it only when every gate passed on a clean tree whose HEAD did not move |

## `dispatch`

| Key | Type | Default | Read by |
|---|---|---|---|
| `dispatch.defaultModel` | string | `"sonnet"` | dispatch guard: model of a `general-purpose` or `Explore` dispatch that names none |
| `dispatch.defaultEffort` | `low`, `medium`, `high`, `xhigh`, `max` | `"medium"` | dispatch guard: effort set with the default model, unless the dispatch names one |
| `dispatch.heavyMarker` | boolean | `true` | dispatch guard: a `general-purpose` dispatch on Opus goes ahead only with a line `Heavy: <path>` whose file says "heavy" |
| `dispatch.forkBan` | boolean | `true` | dispatch guard: refuses a fork dispatch |
| `dispatch.guardrailsFile` | path | `null` | dispatch guard and `dispatch-guardrails`: a repository file whose text the guard appends after the plugin's default block, to every dispatch of an agent that can edit; a file that cannot be read refuses the dispatch |

## `judges`

| Key | Type | Default | Read by |
|---|---|---|---|
| `judges.skill` | string | `"judge-protocol"` | read-only enforcement: the skill whose agents are judges |
| `judges.maxRechecks` | integer >= 1 | `3` | re-check guard and the judge protocol: the one value both read |
| `judges.routes` | `{agent: string, ground: glob[]}[]` | `[]` | `docrank judges [<range>]` and the ship skill: a judge is launched when a changed path matches one of its `ground` globs, `["**"]` being every change. Empty means no judge is named |

## `paths`

| Key | Type | Default | Read by |
|---|---|---|---|
| `paths.builtIns` | boolean | `true` | path guard: the built-in rules, `.env*` but `.env.example`, and lockfiles |
| `paths.rules` | `{pattern: regex, onlyIfTracked: boolean = false, reason: string}[]` | `[]` | path guard: an edit to a matching path is refused with `reason`; `onlyIfTracked` limits it to files git already tracks |

## `plan`

| Key | Type | Default | Read by |
|---|---|---|---|
| `plan.requiredHeadings` | string[] | `[]` | plan guard: a plan reaches the user only with a section whose heading (any level, case-insensitive) is one of these; empty means off. Several entries are alternatives, such as a second language |

## `format`

| Key | Type | Default | Read by |
|---|---|---|---|
| `format.command` | string | `null` | format on edit: run on each edited file of the repository, the path appended |
| `format.lintCommand` | string | `null` | format on edit: run after it on files with a `lintExtensions` extension; its output is reported, never fixed |
| `format.lintExtensions` | string[] | `[]` | format on edit: extensions (`".ts"`) that get `lintCommand`; empty means none |

## `docDrift`

| Key | Type | Default | Read by |
|---|---|---|---|
| `docDrift.baseRef` | string | `origin/<integration>` | doc drift on stop: the work is compared against its merge-base with this ref |
| `docDrift.entries` | `{code: path prefix[], docs: path prefix[]}[]` | `[]` | doc drift on stop: code a document states, and the documents; empty means off. Drift-pairs check: each path must exist |
| `docDrift.unpaired` | map of path prefix to reason | `{}` | drift-pairs check: code under `docs.unitRoots` that states nothing a document owns, with why; a prefix that excuses no unpaired unit is refused |

## `worktree`

| Key | Type | Default | Read by |
|---|---|---|---|
| `worktree.copy` | string[] | `[".env", ".mcp.json"]` | worktree creation: paths relative to the main checkout, copied into the new worktree when present. A plugin's `WorktreeCreate` hook replaces Claude Code's default, so `.worktreeinclude` is not read |
| `worktree.install` | string | `null` | worktree creation: shell command run in the new worktree, its output sent to stderr; a failure is reported and does not fail the creation. null means none |

## `pr`

| Key | Type | Default | Read by |
|---|---|---|---|
| `pr.productPaths` | path prefix[] | `[]` | PR handover guard: a `gh pr create` into `branches.integration` whose diff against `origin/<integration>` touches one is refused with `checklist`, the first of a branch in a session only, unless `requiredLines` decides it. Empty here and in `surface.paths` means off |
| `pr.requiredLines` | regex[] | `[]` | PR handover guard: what passes it is evidence. Each entry is a regular expression, tried with the flags `i`, `m` and `u` (Unicode, case-insensitive) against each line of the pull request body, which the guard reads from the command: `--body`/`-b`, or the file `--body-file`/`-F` names, resolved against the directory the command runs in. A body with a line for every entry passes at the first attempt; one that lacks an entry is refused every time, naming the missing entries beside `checklist`. `--fill`, no body flag, `-` (stdin) and a file that cannot be read count as no body. Empty means the once-per-branch refusal |
| `pr.checklist` | string | a generic handover line | PR handover guard: the text of that refusal. The default ends by telling the session to run the command again; a replacement should too |
| `pr.ciBases` | glob[] | `[<integration>]` | `scripts/watch-pr.mjs`: bases whose pull requests run CI; the watcher of any other reports `NO CI` and exits 0 |

## `docs`

| Key | Type | Default | Read by |
|---|---|---|---|
| `docs.precedence` | (path prefix \| path prefix[])[] | `[]` | spec arbiter: the ladder of governing documents, highest rank first, one rank per entry; an array is several prefixes of one rank, as `["docs/definition.md", ["docs/spec/", "docs/app/"], "DESIGN.md"]`. Documents of one rank that disagree are a doc defect the user settles. Empty, the arbiter has no ladder and says so instead of judging |
| `docs.invariants` | path | `null` | spec arbiter: the document holding the invariants that span documents |
| `docs.registry` | path | `null` | spec arbiter: the registry of facts a document repeats and code enumerates |
| `docs.scanRoots` | path[] | `[]` | sections check: files and directories whose section references (a document's name, then `§` and a heading) must each name a heading of that document; `"."` is the whole tree; empty means off |
| `docs.historyRoots` | path[] | `[]` | sections check: dated documents, neither scanned nor held as a target, so a reference to one, or to a name one holds, passes |
| `docs.unitRoots` | path[] | `[]` | drift-pairs check: directories (a `*` segment is every directory there, as `packages/*/src`) whose each child directory and source file, tests and dotfiles aside, needs a `docDrift.entries` pair or a `docDrift.unpaired` reason; empty means off |
| `docs.groups` | `{name: string, paths: path prefix[]}[]` | `[]` | `doc-lint` skill: the groups of documents read together, one reader each; empty, the skill has nothing to read and says so |

## `surface`

| Key | Type | Default | Read by |
|---|---|---|---|
| `surface.paths` | path prefix[] | `[]` | surface reviewer and PR handover: code that draws a screen; a diff touching one gets the same refusal as `pr.productPaths`, with `surface.criterion` named first; empty means off |
| `surface.widths` | integer >= 1 [] | `[320, 375, 1280, 1440]` | surface reviewer: viewport widths each page is measured at, in px |
| `surface.locales` | string[] | `[]` | surface reviewer: locales each page is read in; empty, the one the page serves |
| `surface.criterion` | string | `null` | surface reviewer and PR handover: the delivery criterion every screen is judged against, a failure a `surface defect`; null, the reviewer judges without one and says so |

## `ship`

| Key | Type | Default | Read by |
|---|---|---|---|
| `ship.plansDir` | path | `"docs/plans"` | ship skill: where the plan of the work is written |
| `ship.pathJobs` | `{paths: path prefix[], jobs: string[]}[]` | `[]` | ship skill: jobs to run, through the gates skill, for a diff touching one of the entry's paths; each job is a key of `gates.jobs` (the loader refuses any other) |

## `principles`

| Key | Type | Default | Read by |
|---|---|---|---|
| `principles.enabled` | boolean | `true` | session start: injects the working principles |
| `principles.reportLanguage` | string | `"English"` | session start and ship skill: language of hand-over messages and reports |
| `principles.closingLine` | string | `null` | session start: the label of the line that ends every hand-over message; null means no such line |

## `handoff`

| Key | Type | Default | Read by |
|---|---|---|---|
| `handoff.enabled` | boolean | `true` | context hand-off |
| `handoff.tokenThreshold` | integer >= 1 | `250000` | context hand-off: context size, in tokens, past which it asks for the hand-off once |
| `handoff.location` | string | `"plan"` | context hand-off: `"plan"` is the hand-off section of the plan the work follows; any other value is a path |

## `memory`

| Key | Type | Default | Read by |
|---|---|---|---|
| `memory.link` | boolean | `false` | memory link (experimental): links the Claude projects directory holding the session's transcript (`transcript_path`; the directory's naming is not documented, so it is not computed) to the repository's tracked `.claude/memory`, and refuses a transcript outside `<...>/.claude/projects/`; set it only when the repository tracks that directory |

## `watch`

| Key | Type | Default | Read by |
|---|---|---|---|
| `watch.enabled` | boolean | `false` | watch hook: records the session's events for the live view, and its `SessionStart` starts the server and opens the tab. Off, the hook exits at once |
| `watch.port` | integer from 1025 to 65535 | `47173` | watch server and `docrank watch`: the port on `127.0.0.1` that one server, shared by every session of the machine, listens on |
| `watch.language` | `en`, `es` | `"en"` | watch view: the language of its sentences and labels |
| `watch.retentionDays` | integer >= 1 | `30` | watch server: days a recorded session is kept; not applied yet, the history slice deletes older ones |

## `messages`

| Key | Type | Default | Read by |
|---|---|---|---|
| `messages.tools` | regex[] | `[]` | external-message guard: tool names whose call is refused with `checklist` (the first with a given input only, unless `evidenceHeader` decides it), each tested unanchored against the name; only MCP tools (`mcp__*`) reach the hook, because a plugin's hook matcher is static; empty means off |
| `messages.evidenceHeader` | regex | `""` | external-message guard: what passes it is evidence. A regular expression, tried with the flags `i` and `u` against the header row of a Markdown table (a line starting `\|` with its `---` row under it). When an assistant text since the last user prompt of the session's transcript (`transcript_path`) holds one, the call passes at the first attempt; a transcript that is read and holds none refuses every time, with `checklist` and what is missing. A transcript that is absent, unreadable or not in the shape of harness fact 24 falls back to the once-per-input refusal. Empty means that refusal |
| `messages.checklist` | string | a generic claims check | external-message guard: the text of that refusal |

## Example: guarding a local database

`guard.extraDeny` is where a repository states what is irreversible for it. This
one keeps a session from removing the volume of the shared development
database:

```json
{
  "guard": {
    "extraDeny": [
      {
        "pattern": "docker[ \\t]+volume[ \\t]+rm\\b[^|&;]*\\bapp_pgdata\\b",
        "reason": "that volume holds the development database every session shares. Ask the user to remove it."
      }
    ]
  }
}
```
