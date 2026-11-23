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

The install asks for a scope. User scope turns the principles and the default
guards on in every repository on the machine; local or project scope keeps
them to the repository you configure. Auto-update is off for a third-party
marketplace: update with `claude plugin update docrank@docrank`, or turn
auto-update on in the `/plugin` Marketplaces tab.

To try it from a checkout without installing: `claude --plugin-dir <path to this repository>`.

## Quick start

In the repository you want to guard, run `/docrank:init`. It reads the
branches, the package manager, the scripts, the formatter and the docs tree,
proposes a complete `.claude/docrank.json` with a reason for each key it sets,
and writes nothing until you confirm. Without that file every guard runs on its
defaults and the features that need a setting stay off.

The spec arbiter needs two keys: `docs.precedence`, the document that binds,
and `judges.routes`, the code it governs. `init` takes a document that says it
binds, or asks which one does (none is an answer), then asks what code it
governs, `**` by default, and proposes both; without them the arbiter is off and a change gets the gates and guards
only. To see what is on, run `/docrank:init` again: on a configured repository
it keeps your keys and lists what stays at its default and what is off.
`node <plugin>/bin/docrank.mjs config` prints the resolved configuration.

### Try it

`/docrank:demo [<dir>]` builds a throwaway repository, in a new temporary
directory unless you name one that does not exist: a checkout module whose
spec forbids analytics before consent and with the email, and a branch adding
tracking that passes its test and breaks both rules. It prints the command
that opens a session in that branch's worktree with `--plugin-dir`, so the
demo runs whatever scope docrank is installed at, and the three steps to type
there: the gates, the spec arbiter on the branch, and its re-check of the fix.
Each step is a line of its own, to paste as it is; what each should show is
printed apart, after them, so the judge is not told what to find.

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
| Agent | a fork dispatch; a `general-purpose` Opus dispatch with no `Heavy:` line; completes a dispatch with the guardrails block, and sets the default model and effort | `dispatch.*` |
| SendMessage | a message to a judge past its re-check limit, once | `judges.maxRechecks` |
| Edit, Write | `.env*` except `.env.example`, lockfiles, and the repository's own rules | `paths.builtIns`, `paths.rules` |
| ExitPlanMode | a plan without a required heading | `plan.requiredHeadings` |
| `gh pr create` | one whose diff touches product or surface paths, with the handover checklist: once per branch, or, with `pr.requiredLines`, every time its body lacks one of the lines | `pr.*`, `surface.paths` |
| MCP tools | a message through a configured tool, with a claims checklist: once per input, or, with `messages.evidenceHeader`, every time the turn wrote no claims table | `messages.*` |

Around them, not refusing: the formatter and linter run on each edited file
(`format.*`), a question at the end of a session whose code changes a document
did not follow (`docDrift.*`), a worktree cut from the fetched integration
branch with the repository's ignored files copied in (`worktree.*`), the working
principles at session start (`principles.*`), a hand-off request when the
context grows past a threshold (`handoff.*`), and an optional link between
Claude Code's memory and the repository's tracked `.claude/memory` (`memory.link`,
experimental).

An invalid `.claude/docrank.json` refuses every guarded call and names each
problem; the optional pre-push hook refuses a push on a file it cannot read or
parse, or whose keys it reads have the wrong type. A guard stops accidents, not
a determined attempt: every Bash refusal is also logged to
`~/.claude/blocked-commands.log`.

## Skills, agents and the CLI

Skills: `init` (propose the configuration), `gates` (run `gates.run` in order,
PASS or FAIL each, and record the commit that passed), `ship` (one piece of
work from worktree to a green pull request; the merge stays yours),
`doc-lint` (sweep the documents for what no test catches), `demo` (build the
throwaway repository of Try it),
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
- `worktree <branch>` makes the worktree `claude -w` makes (cut from the
  fetched `origin/<branches.integration>`, `worktree.copy` copied,
  `worktree.install` run) for a session the hook did not reach, and prints its
  path.

- `watch [--no-open]` starts the watch server when none runs, prints the
  page's address and opens it.

`templates/pre-push` is an optional git hook with the same gates check, for
pushes made outside Claude Code; `init` offers it.

## Watch: the session, live, in plain words

For someone who does not read a terminal: a browser tab that shows what a
session is doing, and what past sessions did. At the top, its state: *working*, *waiting for your
permission*, *waiting for your answer* or *done*. Below, a graph of Claude,
the tasks it is working on (the current one highlighted) and the helpers it
dispatched, each under the task it was sent from. Clicking a node shows its
actions as sentences ("Run the tests — it failed", "Tried to send the work to
the shared repository (push); a safety rule stopped it"), the exact command or
path folded behind *detail*. English or Spanish.

On the left, the sessions on record, grouped by repository, live ones first,
each with its start, its state and how many tasks it had; the tab follows the
newest until one is picked. Under the graph, a timeline: a past session opens
at its end, and the slider moves through it line by line, the graph and the
feeds drawn as they stood at that point; *Play* replays it from the start,
*Pause* stops it. A live session can be moved through the same way, and
*Follow the activity* brings it back to now.

Switch it on with `"watch": { "enabled": true }` in `.claude/docrank.json`
([docs/config.md](docs/config.md#watch)). The next session starts one server
for the whole machine on `127.0.0.1:47173` (`watch.port`) and opens the tab,
unless one is already open, which then follows the new session; under `CI` or
over SSH no tab opens. `docrank watch` opens it any time. The server stops
itself after 30 minutes without activity.

Tasks come from Claude Code's task tools, which are off by default on models
newer than Opus 4.7, Sonnet 4.6 and Haiku 4.5 ([harness fact 22](docs/harness-facts.md)).
Without them every action lands in *work without a list*; to get the list,
start Claude Code with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`.

What is stored: one JSON line per hook event in
`~/.claude/docrank/watch/<repository>-<hash>/<session id>.jsonl` (directory
0700, file 0600), outside every repository. A line keeps the tool's name and
only the fields its sentence names: a command and its description, a path, a
search pattern, a URL, a task's subject, a helper's errand. Secrets in them
(tokens, passwords, `Authorization` headers, credentials in URLs, values
written to an env file) are replaced with `[redacted]`. No tool output, no
prompt and no file content is kept. The page is served to `127.0.0.1` only,
with a random token in its address. A session is kept for 30 days after its
last line (`watch.retentionDays`): the server deletes older ones when it
starts and once a day, and never one that wrote within the last 30 minutes.

## Requirements

Node 20 or later, git, and `gh` for the pull request features. macOS and Linux;
Windows is not supported. The plugin has no run-time npm dependency, and the
browser server of `surface-reviewer` needs `npx` and Chrome. The watch page is
a prebuilt bundle in `ui/dist`, so it needs only a browser.

## What is proved live, and what is not

Trial runs of the installed plugin in two real repositories proved the Bash
guard, the gates and their record before a push, format and lint on edit, the
session-start principles, a judge review and its re-check count, doc drift on
`Stop`, `WorktreeCreate` and the browser server
([docs/harness-facts.md](docs/harness-facts.md) § 15). The plan, pull-request and
message guards, the context hand-off and the judges' preloaded protocol ran
live too. A third trial, with Claude Code 2.1.329, walked the demo from
`/docrank:demo` to the arbiter's `code defect` and its re-check on the fix in
9 min 07 s, and saw `init` propose the arbiter and install the pre-push. A
fourth installed 0.2.0 from the marketplace at project scope, on a machine
without docrank and with no other configuration, and walked the demo to the
same finding and its re-check in 5 min 14 s, proving the example's changes
made after the third. A fifth, with Claude Code 2.1.330 and every session
driven by Claude rather than read by a person, updated that install to 0.2.1
and walked the demo, each printed step typed alone, to the finding and its
clean re-check in 3 min 56 s, proving the demo's step output; proved that a
hook reads the `.claude/docrank.json` of the worktree a session is started
in; and saw `init` read with Read and one command per Bash call, offer
`src/**` ahead of the named file for the ground and pair `src/` for doc drift,
proving its wording changed after the third, then, on the 0.2.2 branch, run
with no error. A sixth, with 0.3.0 and a session driven by Claude, proved
watch: the session's hook started the server, and the page, read in a
headless Chrome, showed the wait for permission and for an answer, three
tasks and their states, an Explore helper under its task with its errand, a
gate run inside the gates helper, and the guard's refusal of a push as a
plain warning with its command folded; `SessionEnd` from the plugin was
recorded on leaving. Its three defects, a graph framed on part of its nodes,
a forked skill's helper with no errand and the session list naming another
repository than the header, are fixed in 0.4.0. Not proved for watch: the
tab opening by itself, a person reading the page, Linux. Not yet exercised
live, though tested on stubbed input: the
closing line rule, and the memory link, which is experimental: off by default,
its directory rule undocumented by Claude Code.

## License

MIT.
