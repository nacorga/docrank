# stickler

A Claude Code plugin that enforces a working method instead of asking for it.
Guard hooks refuse what cannot be taken back; read-only judges review a change
against the repository's documents; the repository's gates must pass before a
push; documents outrank code when the two disagree; a short set of working
principles starts every session. One file per repository,
`.claude/stickler.json`, adapts all of it, and the `init` skill proposes that
file by reading the repository.

stickler was named docrank until 0.6.0; the tags `docrank--v*` stay.

## Install

```
/plugin marketplace add nacorga/stickler
/plugin install stickler@stickler
```

On Claude Code 2.1.275 or later, one step: `/plugin install stickler --marketplace nacorga/stickler`.

The install asks for a scope. User scope turns the principles and the default
guards on in every repository on the machine; local or project scope keeps
them to the repository you configure. Auto-update is off for a third-party
marketplace: update with `claude plugin update stickler@stickler`, or turn
auto-update on in the `/plugin` Marketplaces tab. A project-scope install
is recorded in `.claude/settings.json`, but each clone still runs
`claude plugin install stickler@stickler` once. A cloud session loads only
the plugins installed on the claude.ai account, not those a repository
names. A repository that needs a key of a later release sets `requires`
([docs/config.md](docs/config.md)), and an older stickler then refuses its
configuration instead of misreading it.

Coming from docrank: run `claude plugin uninstall docrank@docrank`, install
`stickler@stickler` as above, and rename `.claude/docrank.json` to
`.claude/stickler.json`. A `DOCRANK_*` environment variable becomes `STICKLER_*`.

To try it from a checkout without installing: `claude --plugin-dir <path to this repository>`.

## Quick start

In the repository you want to guard, run `/stickler:init`. It reads the
branches, the package manager, the scripts, the formatter and the docs tree,
proposes a complete `.claude/stickler.json` with a reason for each key it sets,
and writes nothing until you confirm. Without that file every guard runs on its
defaults and the features that need a setting stay off.

The spec arbiter needs two keys: `docs.precedence`, the document that binds,
and `judges.routes`, the code it governs. `init` takes a document that says it
binds, or asks which one does (none is an answer), then asks what code it
governs, `**` by default, and proposes both; without them the arbiter is off and a change gets the gates and guards
only. To see what is on, run `/stickler:init` again: on a configured repository
it keeps your keys and lists what stays at its default and what is off.
`node <plugin>/cli/stickler.mjs config` prints the resolved configuration.

### Try it

`/stickler:demo [<dir>]` builds a throwaway repository, in a new temporary
directory unless you name one that does not exist: a checkout module whose
spec forbids analytics before consent and with the email, and a branch adding
tracking that passes its test and breaks both rules. It prints the command
that opens a session in that branch's worktree with `--plugin-dir`, so the
demo runs whatever scope stickler is installed at, and the three steps to type
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
| Bash | any command that matches a pattern the repository adds, with the case or line flags it names | `guard.extraDeny` |
| Bash | a write or a command that runs, from a read-only agent | `judges.skill` |
| Agent | a fork dispatch; a `general-purpose` Opus dispatch with no `Heavy:` line; completes a dispatch with the guardrails block, and sets the default model and effort | `dispatch.*` |
| SendMessage | a message to a judge past its re-check limit, once; a message to an agent that can edit and whose transcript shows a compaction, once, asking for a fresh one | `judges.maxRechecks`; the compaction is always on |
| Edit, Write | `.env*` except `.env.example`, lockfiles, and the repository's own rules | `paths.builtIns`, `paths.rules` |
| ExitPlanMode | a plan without a required heading | `plan.requiredHeadings` |
| `gh pr create` | one whose diff touches product or surface paths, with the handover checklist: once per branch, or, with `pr.requiredLines`, every time its body lacks one of the lines the diff owes (an entry with `paths` is owed only by a diff that touches them) | `pr.*`, `surface.paths` |
| MCP tools | a message through a configured tool, with a claims checklist: once per input, or, with `messages.evidenceHeader`, every time the turn wrote no claims table | `messages.*` |

Around them, not refusing: the formatter and linter run on each edited file
(`format.*`), a question at the end of a session whose code changes a document
did not follow (`docDrift.*`), a worktree cut from the fetched integration
branch with the repository's ignored files copied in, and, when `worktree.prune` is on, the merged ones removed at session start (`worktree.*`), the working
principles at session start (`principles.*`), a hand-off request when the
context grows past a threshold (`handoff.*`), and an optional link between
Claude Code's memory and the repository's tracked `.claude/memory` (`memory.link`,
experimental).

Off until configured, for the session's own hygiene: a file of the repository
added as context to a prompt that matches a pattern, such as a protocol a
session should follow whenever a prompt opens with a given word
(`prompts.context`); at session start and after each compaction, the plans in
`ship.plansDir` with their checked items over all of them and whether each has
a hand-off section (`plans.atStart`); and the reaper, which stops the servers
sessions left running in the repository's checkouts once nobody holds them: at
session start, those of sessions that are gone, at session end, the ending
session's own (`reap.*`). The reaper reaches only processes carrying a
session's `CLAUDE_PID`, which is inherited: a tmux server, a build daemon or an
editor launched from a session's shell carries it too, and `reap.keep` is what
keeps such a process running.

An invalid `.claude/stickler.json` refuses every guarded call and names each
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

The CLI is `node <plugin>/cli/stickler.mjs <command>`:

- `config` prints the resolved configuration, or each error and exit 1.
- `check sections` and `check drift-pairs` hold the documents to their
  references and to a pair for every code unit (`docs.scanRoots`, `docs.unitRoots`).
- `judges [<range>]` names the judges a diff needs (`judges.routes`).
- `worktree <branch> [<base>]` makes the worktree `claude -w` makes (cut from the
  fetched `origin/<branches.integration>`, or from the fetched `origin/<base>`
  when slices share a branch; `worktree.copy` copied, `worktree.install` run)
  for a session the hook did not reach, and prints its path.

- `watch [--no-open]` starts the watch server when none runs, prints the
  page's address and opens it.

`templates/pre-push` is an optional git hook with the same gates check, for
pushes made outside Claude Code; `init` offers it.

## Watch: the session, live, in plain words

For someone who does not read a terminal: a browser tab that shows what a
session is doing, and what past sessions did. At the top, its state: *working*, *waiting for your
permission*, *waiting for your answer* or *done*. Below, a graph of Claude,
the tasks it is working on (the current one highlighted), or its turns when it
keeps no task list, and the subagents it
dispatched, each under the task or turn it was sent from, with its type
(`Explore`, `general-purpose`) and the skill it was forked for
(`stickler:gates`) as small chips. Clicking a node shows its
actions as sentences ("Run the tests — failed", "Tried to send the work to
the shared repository (push); a safety rule stopped it"), each with chips
naming its tool (`Bash`, `Read`, `mcp__browser__browser_snapshot`), the gate
it ran and the guard that refused it (`guard-bash`). A call that ran to an
end carries ✓ or ✗ on its gate chip when it ran one (`run-gates ✓`,
`run-gates ✗`), else on its tool chip (`Bash ✗`); a failed command's exit
code and the exact command or path are folded behind *detail*. English or
Spanish.

When the session is done, or waits for your answer after a turn of work, a
summary card heads the side panel: how many tasks were done of those listed
(or how many turns, with no list), the subagents used by type (`Explore ×1`),
whether the checks passed (`run-gates ✓`, `run-gates ✗`), the actions a
safety rule stopped by guard (`guard-bash ×1`), how many actions failed
("Nothing failed" too), and how long it took, from its first event to its
last.

On the left, the sessions on record, grouped by repository, live ones first,
each with its start, its state and how many tasks it had; the tab follows the
newest until one is picked. Under the graph, a timeline: a past session opens
at its end, on its summary card, and the slider moves through it line by line, the graph and the
feeds drawn as they stood at that point; *Play* replays it from the start,
*Pause* stops it. A live session can be moved through the same way, and
*Follow the activity* brings it back to now.

Switch it on with `"watch": { "enabled": true }` in `.claude/stickler.json`
([docs/config.md](docs/config.md#watch)). The next session starts one server
for the whole machine on `127.0.0.1:47173` (`watch.port`) and opens the tab,
unless one is already open, which then follows the new session; under `CI` or
over SSH no tab opens. `stickler watch` opens it any time. The server stops
itself after 30 minutes without activity.

Tasks come from Claude Code's task tools, which are off by default on models
newer than Opus 4.7, Sonnet 4.6 and Haiku 4.5 ([harness fact 22](docs/harness-facts.md)).
Without them watch groups the work by turn, *Turn 1*, *Turn 2*…, one per
prompt; a background subagent's result, which reaches Claude as a prompt, opens
no turn when it comes within seconds of that subagent's end (a guess: no prompt
text is stored). To get the list,
start Claude Code with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`. `init`, when it turns
watch on, offers to write that variable into the `env` of the repository's
`.claude/settings.json`, and writes nothing without a yes. That the task tools
follow it from there is not documented; it was proved in `-p` mode, not yet in an
interactive session ([harness fact 25](docs/harness-facts.md)). It takes effect
from the next session started in the repository.

What is stored: one JSON line per hook event in
`~/.claude/stickler/watch/<repository>-<hash>/<session id>.jsonl` (directory
0700, file 0600), outside every repository. A line keeps the tool's name and
only the fields its sentence names: a command and its description, a path, a
search pattern, a URL, a task's subject, a subagent's errand. Secrets in them
(tokens, passwords, `Authorization` headers, credentials in URLs, values
written to an env file) are replaced with `[redacted]`. No tool output, no
prompt and no file content is kept: of a result, only whether the call
failed and, for a command, its exit code; of a prompt, only the name of the
slash command it opens with, such as `stickler:gates`. The page is served to `127.0.0.1` only,
with a random token in its address. A session is kept for 30 days after its
last line (`watch.retentionDays`): the server deletes older ones when it
starts and once a day, and never one that wrote within the last 30 minutes.

## Requirements

Node 20 or later, git, and `gh` for the pull request features. macOS and Linux;
Windows is not supported. The plugin has no run-time npm dependency, and the
browser server of `surface-reviewer` needs `npx` and Chrome. The watch page is
a prebuilt bundle in `ui/dist`, so it needs only a browser. The reaper reads
`ps`, and on macOS `lsof` and `python3` (to read another process's
environment); without them it stops nothing.

## What is proved live, and what is not

Trial runs of the installed plugin in two real repositories proved the Bash
guard, the gates and their record before a push, format and lint on edit, the
session-start principles, a judge review and its re-check count, doc drift on
`Stop`, `WorktreeCreate` and the browser server
([docs/harness-facts.md](docs/harness-facts.md) § 15). The plan, pull-request and
message guards, the context hand-off and the judges' preloaded protocol ran
live too. A third trial, with Claude Code 2.1.329, walked the demo from
`/stickler:demo` to the arbiter's `code defect` and its re-check on the fix in
9 min 07 s, and saw `init` propose the arbiter and install the pre-push. A
fourth installed 0.2.0 from the marketplace at project scope, on a machine
without stickler and with no other configuration, and walked the demo to the
same finding and its re-check in 5 min 14 s, proving the example's changes
made after the third. A fifth, with Claude Code 2.1.330 and every session
driven by Claude rather than read by a person, updated that install to 0.2.1
and walked the demo, each printed step typed alone, to the finding and its
clean re-check in 3 min 56 s, proving the demo's step output; proved that a
hook reads the `.claude/stickler.json` of the worktree a session is started
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
repository than the header, are fixed in 0.4.0. A seventh, with 0.4.0, proved
watch's history: the sessions list showed the live session first and the
sixth's below it, each with its state and task count; scrubbing the live
session's timeline drew the graph as it stood at that step while the log
grew; and the sixth's session replayed with "Play". Its defect, a session
read as waiting for an answer while a helper still worked after the turn
ended, is fixed in 0.4.1. An eighth, with 0.5.0 in `-p` mode and no task
list, proved turns, the verdicts and the closing card: three runs of one
session read as three turns, the gates' subagent under the second, a command
exiting 3 as `Bash ✗` with its exit code ([harness fact 26](docs/harness-facts.md)),
and the card summing it up. Its defects, a skill typed as the prompt giving
its subagent no errand and two repositories of one name sharing a heading in
the sessions list, are fixed in 0.5.1. Not proved for watch: the tab
opening by itself, a person reading the page, an older server replaced live,
the daily retention sweep, Linux, and the task tools turned on from
`.claude/settings.json` in an interactive session (fact 25). Not yet exercised
live, though tested on stubbed input: the
closing line rule, and the memory link, which is experimental: off by default,
its directory rule undocumented by Claude Code.

## License

MIT.
