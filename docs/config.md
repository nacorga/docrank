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
| `branches.protected` | string[] | `["main", "master"]` | Bash guard: nothing lands on these by a push or a local write |
| `branches.integration` | string | `"main"` | Bash guard, worktrees (cut from it), doc drift and `pr` defaults |
| `branches.allowedPrBases` | glob[] | `[<integration>]` | Bash guard: `gh pr create` against any other base is refused |

## `guard`

| Key | Type | Default | Read by |
|---|---|---|---|
| `guard.blockedTagPatterns` | regex[] | `[]` | Bash guard: a tag push matching one is refused |
| `guard.publishBan` | boolean | `true` | Bash guard: refuses `npm publish` and `pnpm publish` |
| `guard.extraDeny` | `{pattern: regex, reason: string}[]` | `[]` | Bash guard: a command matching `pattern` is refused with `reason` |

## `gates`

| Key | Type | Default | Read by |
|---|---|---|---|
| `gates.run` | `{name: string, command: string}[]` | `[]` | gates skill and runner: run in order, stop at the first failure; names are unique. Empty means no gates |
| `gates.jobs` | map of name to command | `{}` | gates skill: run only when named |
| `gates.requireBeforePush` | boolean | `true` | Bash guard: a push needs the record of a pass on the clean HEAD; moot while `gates.run` is empty |
| `gates.record` | string | `"docrank-gates-passed"` | gates runner and Bash guard: file name, in the git common directory, holding the HEAD that passed |

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
| `judges.routes` | `{agent: string, ground: glob[]}[]` | `[]` | judges routing: which judge a diff needs, by the paths it touches |

## `paths`

| Key | Type | Default | Read by |
|---|---|---|---|
| `paths.builtIns` | boolean | `true` | path guard: the built-in rules, `.env*` but `.env.example`, and lockfiles |
| `paths.rules` | `{pattern: regex, onlyIfTracked: boolean = false, reason: string}[]` | `[]` | path guard: an edit to a matching path is refused with `reason`; `onlyIfTracked` limits it to files git already tracks |

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
| `docDrift.entries` | `{code: path prefix[], docs: path prefix[]}[]` | `[]` | doc drift on stop: code a document states, and the documents; empty means off |

## `worktree`

| Key | Type | Default | Read by |
|---|---|---|---|
| `worktree.copy` | string[] | `[".env", ".mcp.json"]` | worktree creation: files copied from the main checkout when present |
| `worktree.install` | string | `null` | worktree creation: command run in the new worktree; null means none |

## `pr`

| Key | Type | Default | Read by |
|---|---|---|---|
| `pr.productPaths` | path prefix[] | `[]` | PR handover guard: a diff touching one is refused once with `checklist`; empty means off |
| `pr.checklist` | string | a generic handover line | PR handover guard: the text of that refusal |
| `pr.ciBases` | glob[] | `[<integration>]` | PR watch: bases whose pull requests run CI; others report `NO CI` |

## `docs`

| Key | Type | Default | Read by |
|---|---|---|---|
| `docs.precedence` | path prefix[] | `[]` | spec arbiter: the ladder of governing documents, highest rank first |
| `docs.invariants` | path | `null` | spec arbiter: the document holding the invariants that span documents |
| `docs.registry` | path | `null` | spec arbiter: the registry of facts a document repeats and code enumerates |
| `docs.scanRoots` | path[] | `[]` | docs-as-spec checks: where section references are resolved |
| `docs.historyRoots` | path[] | `[]` | docs-as-spec checks: documents that may name history (provenance) |
| `docs.unitRoots` | path[] | `[]` | docs-as-spec checks: code directories each of which needs a drift pair |
| `docs.groups` | `{name: string, paths: path prefix[]}[]` | `[]` | doc sweep: the groups of documents read together |

## `surface`

| Key | Type | Default | Read by |
|---|---|---|---|
| `surface.paths` | path prefix[] | `[]` | surface reviewer and PR handover: code that draws a screen; empty means off |
| `surface.widths` | integer >= 1 [] | `[320, 375, 1280, 1440]` | surface reviewer: viewport widths measured, in px |
| `surface.locales` | string[] | `[]` | surface reviewer: locales each page is read in |
| `surface.criterion` | string | `null` | surface reviewer: the delivery criterion a screen is judged against |

## `ship`

| Key | Type | Default | Read by |
|---|---|---|---|
| `ship.plansDir` | path | `"docs/plans"` | ship skill: where the plan of the work is written |
| `ship.pathJobs` | `{paths: path prefix[], jobs: string[]}[]` | `[]` | ship skill: jobs to run for a diff touching those paths; each job is a key of `gates.jobs` |

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
| `memory.link` | boolean | `false` | memory link: links Claude Code's memory directory to the repository's tracked `.claude/memory`; set it only when the repository tracks that directory |

## `messages`

| Key | Type | Default | Read by |
|---|---|---|---|
| `messages.tools` | regex[] | `[]` | external-message guard: tool names whose first call is refused with `checklist`; empty means off |
| `messages.checklist` | string | a generic claims check | external-message guard: the text of that refusal |
