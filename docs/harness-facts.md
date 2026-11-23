# Claude Code facts docrank depends on

Read from code.claude.com on 2026-11-18, one entry per fact. A fact is
VERIFIED with the page it was read on and a short quote, or NOT DOCUMENTED.
Nothing here comes from memory. A slice that depends on a NOT DOCUMENTED fact
says what it does without it.

Pages: [hooks]=https://code.claude.com/docs/en/hooks.md,
[components]=https://code.claude.com/docs/en/plugins/components.md,
[manifest]=https://code.claude.com/docs/en/plugins/manifest-reference.md,
[marketplace]=https://code.claude.com/docs/en/plugins/marketplace-reference.md,
[skills]=https://code.claude.com/docs/en/skills.md,
[sub-agents]=https://code.claude.com/docs/en/sub-agents.md,
[claude-dir]=https://code.claude.com/docs/en/claude-directory.md,
[tools]=https://code.claude.com/docs/en/tools-reference.md.
Fact 16 was read on 2026-11-20 from
[plugins]=https://code.claude.com/docs/en/plugins.md,
[loading]=https://code.claude.com/docs/en/plugins/loading.md,
[plugin-cli]=https://code.claude.com/docs/en/plugins/cli-reference.md,
[settings]=https://code.claude.com/docs/en/settings.md,
[permissions]=https://code.claude.com/docs/en/permissions.md,
[worktrees]=https://code.claude.com/docs/en/worktrees.md and [hooks].
Facts 17 to 23 (docrank watch) and 24 were read on 2026-11-23 from [hooks], [tools],
[components],
[sdk-todo]=https://code.claude.com/docs/en/agent-sdk/todo-tracking.md and
[sdk-ts]=https://code.claude.com/docs/en/agent-sdk/typescript.md.
Fact 25 was read on 2026-11-23 from [settings], [tools],
[env-vars]=https://code.claude.com/docs/en/env-vars.md and
[settings-ref]=https://code.claude.com/docs/en/settings-reference.md.

| # | Fact | Status |
|---|---|---|
| 1 | `${CLAUDE_PLUGIN_ROOT}` works in hook commands | VERIFIED |
| 2 | A plugin can wire `WorktreeCreate` | VERIFIED, with two limits; PROVED LIVE |
| 3 | A plugin can wire `Stop` and `SessionEnd` | NOT DOCUMENTED per event; both PROVED LIVE |
| 4 | A plugin's `SessionStart` hook can return `additionalContext` | VERIFIED |
| 5 | The hook input carries `agent_type` | VERIFIED |
| 6 | Plugin agents' `mcpServers` and `skills` frontmatter | `mcpServers` ignored, the plugin's `.mcp.json` instead; `skills` supported, a plugin skill's name there NOT DOCUMENTED; browser server PROVED LIVE |
| 7 | Skill `allowed-tools` with a plugin path | VERIFIED |
| 8 | `subagents/agent-<id>.meta.json` | Named, its fields NOT DOCUMENTED |
| 9 | `~/.claude/projects/<slug>` naming | NOT DOCUMENTED as a rule |
| 10 | Plugin skills carry `context: fork`, `model`, `allowed-tools` | VERIFIED |
| 11 | Plugin manifest and marketplace shapes | VERIFIED |
| 12 | The type of the agent a `SendMessage` reaches | VERIFIED, recorded at dispatch; PROVED LIVE |
| 13 | PreToolUse `updatedInput` and `additionalContext`; the Agent tool's `name` and `effort` | VERIFIED |
| 14 | Hook matcher syntax, plugin hooks included | VERIFIED |
| 16 | Where an installed plugin is on; `--plugin-dir` beside an install; a session started in a worktree | VERIFIED; that a hook's `cwd` is the launch directory, NOT DOCUMENTED; PROVED LIVE |
| 17 | The events watch reads and their inputs | VERIFIED; `SessionEnd` from a plugin as fact 3 |
| 18 | `Notification` types: the two waiting states | VERIFIED, with their delays |
| 19 | `async: true` on a command hook, from a plugin | VERIFIED; for a plugin, by its shape only |
| 20 | A hook that fails or times out does not block | VERIFIED |
| 21 | A `PreToolUse` hook's refusal fires no other event | VERIFIED |
| 22 | The task tool sets and their shapes | VERIFIED; off by default on newer models |
| 23 | A helper's errand; a non-interactive session in the hook input | errand by order; an id match and the `-p` signal NOT DOCUMENTED |
| 24 | `transcript_path` in the hook input, and the shape of a transcript line | path VERIFIED; the line shape NOT DOCUMENTED, so a fallback |
| 25 | `CLAUDE_CODE_ENABLE_TODO_TOOLS` in the `env` of a repository's `.claude/settings.json` | the `env` reaching the session VERIFIED, after workspace trust; that the task tools follow it from that file NOT DOCUMENTED, not proved live |

## 1. `${CLAUDE_PLUGIN_ROOT}` in hook commands: VERIFIED

[manifest] § Environment variables, table "Where each variable resolves":
"Hook commands | Anywhere in `command` and `args` | `CLAUDE_PLUGIN_ROOT`,
`CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR`, and `CLAUDE_PLUGIN_OPTION_<KEY>`".
[components] § Hooks: "wrap the `${CLAUDE_PLUGIN_ROOT}` path in double quotes
... to keep the expanded path one shell word". The variable is not present in
commands Claude runs through the Bash tool ([manifest]: "The variables aren't
present in the environment of commands Claude runs through the Bash tool").

## 2. `WorktreeCreate` from a plugin: VERIFIED, with two limits

[hooks] § WorktreeCreate: "a plugin's hook doesn't run for the one created when
you launch with `--worktree` and `--tmux`: ... Claude Code creates the worktree
before it loads plugins ... Before v2.1.300, a plugin's WorktreeCreate hook
didn't run with `--worktree` alone either." So a plugin hook runs from v2.1.300,
and not with `--worktree --tmux`.

The contract: "The hook must return the path to the created worktree
directory" (command hooks print it "as the last non-empty line of stdout"), and
"Because the hook replaces the default behavior entirely, `.worktreeinclude` is
not processed".

The hook's input fields are NOT DOCUMENTED on the page read: `hooks/worktree-create.mjs`
reads `name` and `cwd` from it. Proved live (§ 15): `claude -w wt-probe`
created `<repo>-wt-probe` on branch `wt-probe` cut from `origin/main`. No matcher is supported;
the hook fires on every creation.

Slice 6 without it (older Claude Code, `--tmux`): the repository's own
settings carry the hook, which `init` offers to write.

## 3. `Stop` and `SessionEnd` from a plugin: NOT DOCUMENTED per event

[components] § Hooks says plugin hooks go in `hooks/hooks.json` "in the same
shape as the `hooks` object in `settings.json`" and "Claude Code registers them
when a session loads the plugin, and they fire on their events from then on".
No page lists which events a plugin may register, and none excludes `Stop` or
`SessionEnd`; [hooks] describes both events without tying them to plugins.

`Stop` from the plugin's `hooks/hooks.json` is proved live (§ 15): doc drift
blocked a session's end with its message. `SessionEnd`, wired by watch since
0.3.0, is proved live too (§ 15, both watch trials): leaving an interactive
session recorded it with `reason` `prompt_input_exit`.

## 4. `SessionStart` `additionalContext` from a plugin: VERIFIED

[hooks] § Context only: "`hookSpecificOutput.additionalContext` adds context for
Claude" and, for SessionStart, "String added to Claude's context at the start
of the conversation, before the first prompt". Also "Claude Code adds a
SessionStart hook's plain-text stdout to Claude's context". That a plugin can
register `SessionStart`: [components] § Install dependencies into the data
directory carries a plugin `SessionStart` hook, and [hooks] says "If your
plugin's SessionStart hook supplies `initialUserMessage` or `sessionTitle`,
install the plugin before the session starts". `SessionStart` runs again on
`resume`, so slice 8's injection is idempotent by design.

## 5. `agent_type` in the hook input: VERIFIED

[hooks] § Common input fields: "`agent_type`: Agent name (for example,
`"Explore"` or `"security-reviewer"`). Present when the session uses `--agent`
or the hook fires inside a subagent." and "`agent_id` ... Unique identifier for
the subagent or in-process teammate the hook fires in."

For a subagent a plugin ships, [hooks] § matchers: "the agent type is the
plugin-scoped identifier such as `my-plugin:reviewer`, not the bare frontmatter
name". Slice 3 must compare against `docrank:<name>`.

## 6. Plugin agents' `mcpServers` and `skills`: split

[sub-agents] § Choose the subagent scope: "For security reasons, plugin
subagents don't support the `hooks`, `mcpServers`, or `permissionMode`
frontmatter fields. These fields are ignored when loading agents from a
plugin." [components] § Frontmatter fields in plugin agents: supported fields
are "`name`, `description`, `model`, `effort`, `maxTurns`, `autoCompactWindow`,
`tools`, `disallowedTools`, `skills`, `memory`, `background`, `omitClaudeMd`,
`isolation`, `color`" and ignored are "`permissionMode`, `hooks`, `mcpServers`,
and `initialPrompt`".

So the surface reviewer cannot pin its browser MCP through its own
frontmatter. [components] § MCP servers: "Declare it in `.mcp.json` at the
plugin root", and § Server names, tool names, and reloads: "Tool names:
`mcp__plugin_<plugin>_<server>__<tool>`". The plugin's `.mcp.json` declares
`browser`, and the reviewer's `tools:` names `mcp__plugin_docrank_browser__*`
tools one by one. [sub-agents]: "Subagents inherit the ... MCP tools available
in the main conversation", so the main session and every agent without a
`tools:` list reach that browser too; an agent whose `tools:` list does not
name them does not.

Cost: every session that loads the plugin starts the server (an `npx`
process), but not Chrome. The pinned version's README
(https://unpkg.com/chrome-devtools-mcp@1.7.0/README.md): "The MCP server will
start the browser automatically once the MCP client uses a tool that requires
a running browser instance" and "Connecting to the Chrome DevTools MCP server
on its own will not automatically start the browser". `--isolated` "creates a
temporary user-data-dir that is automatically cleaned up after the browser is
closed".

`skills:` preloading works; how it names a plugin's own skill is NOT
DOCUMENTED. [skills] names a plugin skill `plugin-name:skill-name` (the bare
name also invokes it "unless another command already uses that name"), so the
judges list `docrank:judge-protocol`, which `lib/agent-types.mjs` accepts as
well as the bare name. PROVED LIVE (§ 15): a judge told to use no tool
quoted the skill's first sentence verbatim with zero tool uses, so
`docrank:judge-protocol` is preloaded under that name.

[components] § Reference plugin paths: `${CLAUDE_PLUGIN_ROOT}` is "substituted
in skill, command, and agent content", which is how a judge finds the
plugin's `docs/config.md`.

## 7. Skill `allowed-tools` with a plugin path: VERIFIED

[skills] § variables: "Claude Code substitutes `${CLAUDE_SKILL_DIR}` and
`${CLAUDE_PROJECT_DIR}` in two places: the skill's markdown content, and Bash
rules in the `allowed-tools` frontmatter. In a plugin skill, Claude Code
substitutes `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` in the same two
places." Example: `allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)`.

## 8. `subagents/agent-<id>.meta.json`: named, its fields NOT DOCUMENTED

[sub-agents] § Message a subagent by name after a restart names the file and
nothing in it: "To find the ID for a name, look for that name in the
`agent-{agentId}.meta.json` files in `~/.claude/projects/{project}/{sessionId}/subagents/`". Documented
beside it: "Each transcript is stored as `agent-{agentId}.jsonl`", and
[claude-dir] "`projects/<project>/<session>/subagents/` | Subagent
transcripts in the same format as the session transcript". No page states the
file's fields, so an agent type read from it would rest on nothing
documented. Slice 3 does not read the file; fact 12 is what it does.

## 9. `~/.claude/projects/<slug>` naming: NOT DOCUMENTED as a rule

[claude-dir] states the rule only for the scratchpad: "`<project>` is your
working directory path with every character other than letters and digits
replaced by `-`, such as `-Users-you-my-project`". For `projects/`, the page
says "Each project gets its own memory directory keyed by the repository path"
and its `claude purge` example shows `/home/user/work/my-repo` as
`projects/-home-user-work-my-repo`. An example, not a stated rule, and none for
a worktree or a path with other characters.

Slice 8 (hand-off, memory link) does not derive the directory. It takes
`transcript_path`, which every hook receives ([hooks] notification example:
`"transcript_path": "/Users/.../.claude/projects/.../00893aaf-....jsonl"`), and
takes its `dirname`. Memory link, which needs the memory directory before any
transcript, is therefore off by default and states this limit.

## 10. Plugin skills carry `context: fork`, `model`, `allowed-tools`: VERIFIED

[skills] frontmatter reference: "`context` | Set to `fork` to run in a forked
subagent context", "`model` | Model to use when this skill is active ... With
`context: fork`, the value sets the forked subagent's model instead",
"`allowed-tools` | Tools Claude can use without asking permission during the
turn that invokes this skill". Plugin skills: "Claude Code skills at any level,
including plugin skills | Every field in the table above". [claude-dir] lists
the fields of `skills/<name>/SKILL.md`, which include `context`, `agent`,
`model`, `effort`, `allowed-tools`.

## 11. Manifest and marketplace shapes: VERIFIED

- `plugin.json` lives at `.claude-plugin/plugin.json`; "`name` is the only
  required key"; "An unrecognized top-level key is stripped"; `license` is an
  SPDX identifier; `author` is an object with required `name` ([manifest]).
- A name starting `claude-` or `anthropic-` is reserved ([manifest] § name);
  `docrank` is not.
- `marketplace.json` lives at `.claude-plugin/marketplace.json`; "`name`,
  `owner`, and `plugins` are required"; an entry needs `name` and `source`; a
  relative `source` "must start with `./`, unless you write a bare name under
  `metadata.pluginRoot`", and `"."` on its own means the root itself
  ([marketplace]). docrank is the marketplace root, so its entry uses `"./"`
  (stated as "a plugin at the marketplace root, with `"source": "./"`").
- A plugin's manifest `version` overrides the entry's; setting `version` pins
  users until it changes ([manifest] § version).
- `claude plugin validate <path>` is "the authoritative check for a manifest"
  ([manifest]); slice 1 runs it when the CLI is available.

## 12. The type of the agent a `SendMessage` reaches: VERIFIED, recorded at dispatch

The `agent_type` of a hook's input names the agent the hook fires in, the
sender of a `SendMessage`, never its recipient. [hooks] § Common input
fields: "`agent_id` and `agent_type` tell your script which agent a hook
fired in". So it cannot tell whether the agent addressed is a judge.

No input of a `SendMessage` hook names the recipient's type. What is
documented is the address and where it comes from:

- [sub-agents] § Resume subagents: "Claude uses the `SendMessage` tool with
  the agent's ID or name as the `to` field to resume it", and "When a
  subagent completes, Claude receives its agent ID".
- [hooks] § Agent (PreToolUse input): `subagent_type` | "Type of specialized
  agent to use"; and for PostToolUse, `tool_response.agentId` | "Identifier
  for the subagent run", present on a foreground result and on a background
  one ("It has `status: "async_launched"`, `agentId`, ...").
- [sub-agents] § Subagent names: "Claude can give a subagent a name by passing
  a `name` parameter on the Agent tool call ... The name makes the subagent
  addressable".

So `hooks/guard-recheck.mjs` also runs as PostToolUse on `Agent` and records,
per session, `agentId` and `name` against `subagent_type`; as PreToolUse on
`SendMessage` it looks `to` up in that record. Limits, each stated by the
same pages: Explore and Plan "return no agent ID", so they are never held
(they are no judges); an agent dispatched before the plugin loaded has no
record and is not held; that the `agentId` of the response is the exact
string `to` carries is read from "Claude receives its agent ID" and its use
as `to`, not from a page that states both in one place; proved live (§ 15). A `SubagentStart` hook also receives `agent_id` and
`agent_type`, but its example `"agent_id": "agent-abc123"` is not the
`agentId` form of the Agent response (`"a4d2c8f1e0b3a297"`), so it is not
used.

## 13. PreToolUse `updatedInput` and `additionalContext`; Agent `name` and `effort`: VERIFIED

[hooks] § PreToolUse decision control: "`updatedInput` | Modifies the tool's
input parameters before execution. Replaces the entire input object, so
include unchanged fields alongside modified ones ... Combine with `"allow"`
to auto-approve" and "With no `permissionDecision`, auto mode can deny the
changed call", so the dispatch guard always pairs it with `"allow"`.
"`additionalContext` | String added to Claude's context alongside the tool
result". `"deny"` "prevents the tool call", with `permissionDecisionReason`.

[hooks] § Agent lists `prompt`, `description`, `subagent_type`, `model`. Two
more inputs are documented elsewhere: `name` (fact 12) and, [sub-agents] §
Choose an effort level, "it can also pass an `effort` parameter for that
invocation ... requires Claude Code v2.1.292 or later". The dispatch guard
sets `model` and `effort` through `updatedInput`; before v2.1.292 the
`effort` it sets has no effect.

## 14. Hook matcher syntax, plugin hooks included: VERIFIED

[hooks] § Matchers, table "Matcher value | Evaluated as": `"*"`, `""` or
omitted match all; "Only letters, digits, `_`, `-`, spaces, `,`, and `|`" is an
exact string or a list of exact strings; "Contains any other character" is a
"JavaScript regular expression, unanchored" (`RegExp.prototype.test`, so
`^`/`$` are needed for a whole-string match). § MCP tool names: tools are
`mcp__<server>__<tool>`; "The `.*` is required: a matcher like `mcp__memory`
... is compared as an exact string and matches no tool", and `mcp__.*__write.*`
is the page's own example. § Plugin hooks: a plugin's hooks "merge with your
user and project hooks"; the one difference stated is that a plugin-bundled
MCP server's tools are named `mcp__plugin_<plugin>_<server>__<tool>`, which
`mcp__.*` also matches. Plugin hooks use the same matchers.

A matcher in `hooks/hooks.json` is static, so `messages.tools` (config) cannot
be it. Slice 5's `guard-message.mjs` registers on `mcp__.*` and filters by
`messages.tools` inside the hook; a tool that is not an MCP tool never reaches
it, which `docs/config.md` states.

## 15. The live trial

Claude Code 2.1.327, the plugin loaded with `--plugin-dir`, in a clone of a
Next.js repository on npm with only `main`, its remote a local bare copy.

- `init` proposed and wrote `.claude/docrank.json`; `docrank config` resolved it.
- SessionStart injected `# Working principles`.
- `guard-bash` refused `git reset --hard`, `git push --force`, an unrecorded
  push and `git branch -D main`, each with its message.
- The `gates` skill (forked, `allowed-tools` through `${CLAUDE_PLUGIN_ROOT}`)
  ran lint, typecheck and build, recorded HEAD, and the same push then passed.
- `docrank judges` named `docrank:spec-arbiter`; it ran read-only (its guard
  refused `git hash-object`) and labelled added tracking a `code defect`
  against the repository's CLAUDE.md. The re-check state recorded the
  dispatch's `agentId` and three sends to that same string as `to`.
- `Stop`: doc drift blocked the end of the session once, with its message.
- `WorktreeCreate`: as § 2.
- The plugin's `browser` server connected; `new_page`, `evaluate_script`
  and `close_page` ran.

A second repository (Next.js, npm, `main` and a `develop` behind it, no tests):
`init` chose `main` as the integration branch and said why; the guard refused
a push to `main` as protected; lint and build passed and the push followed;
`format-on-edit` ran Prettier on an edit and, on a file breaking an ESLint
error rule, returned the lint output to Claude (exit 2).

The rest, in the second repository's clone, each by the hook's own message:

- `guard-pr`: with `pr.productPaths: ["src/"]` and a commit under `src/`, the
  first `gh pr create` was refused with `pr.checklist`; the second passed the
  hook and failed in `gh` (the remote is local).
- `guard-message`: with `messages.tools` naming the browser's `new_page`, the
  first call was refused with `messages.checklist`; the second opened the page.
- `guard-plan`: with `plan.requiredHeadings: ["Verification"]`, in an
  interactive plan-mode session (headless `-p` offers no `ExitPlanMode`), the
  plan without the heading was refused and the one with it approved.
- `context-handoff`: with `handoff.tokenThreshold: 1` and `location:
  "HANDOFF.md"`, `Stop` asked once for the hand-off in `HANDOFF.md`.
- The judge preload: as above.

Not exercised live: `link-memory` (experimental: off by default, and the
directory it links follows a naming Claude Code does not document) and the
`principles.closingLine` rule, which a user's own CLAUDE.md overrode in every
trial session.

### The demo and `init`, 2026-11-20

Claude Code 2.1.329, the plugin loaded with `--plugin-dir` from a checkout at
`9c10859`.

`/docrank:init`, in a copy of `examples/consent` with no `.claude/` and no
sentence stating a rank:

- It asked which document binds, `None` among the options and `docs/spec.md`
  recommended, then the ground, for which the user typed `src/**` and
  `docs/spec.md`.
- It proposed `docs.precedence` and `judges.routes` together; `docrank config`
  exited 0, and `docrank judges` showed the arbiter as `skip`, only
  `.claude/docrank.json` having changed. It said the arbiter was on.
- It offered no fallback hook: 2.1.329 is not older than 2.1.300.
- It installed the pre-push as `.githooks/pre-push`, identical to the
  template, with `core.hooksPath=.githooks`, and tried it: it exited 0 on the
  commit at `origin/main` and 1 on a commit whose gates had not passed, "the
  gates have not passed on fadfb0b".

The demo, from `/docrank:demo` to the re-check:

- `/docrank:demo`, run from `~`, built a new directory under the system's temp
  directory and printed what `scripts/demo.mjs` prints.
- In a session opened in `repo-tracking` with the printed command,
  `/docrank:gates` passed `test` and recorded `4a00491`.
- Asked for the arbiter, the session launched `docrank:spec-arbiter` in the
  background. It reported by message a `code defect` citing
  `examples/consent/docs/spec.md` § Analytics, its lines 16 and 17 as they
  were: the event is sent without consent and carries the email. It also
  named the test that takes the defect for correct, the tests missing, and two
  gaps in the spec: where `consent` comes from, and the event's shape.
- Told to review `demo/fixed`, the session ran `git switch demo/fixed` and sent
  the re-check to the same arbiter's `agentId` ("Resuming agent af99085").
  Verdict: the email, the consent (`src/checkout.mjs:4`) and the test that
  required the email resolved; the consent test nearly, with no case for
  `{ analytics: "yes" }`, which `if (consent.analytics)` would pass; the two
  spec gaps open, the commit not touching `docs/spec.md`. `npm test` 4/4.
- 9 min 07 s wall clock, from `/docrank:demo` (09:18:15Z) to the verdict on
  `demo/fixed` (09:27:22Z), read from the two sessions' transcripts. It
  includes about 2 min of an unrelated question.

A plugin loaded by `--plugin-dir` is named `docrank@inline` in hook messages:
"This hook comes from the docrank@inline plugin."

Found in the trial, and changed after it:

- Doc drift on `Stop` fired after `/docrank:gates`, since the example paired
  `src/` with `docs/spec.md`, and the session found the violations before the
  arbiter was asked. The example no longer sets `docDrift.entries`.
- `init`'s first two Bash calls chained `cat`, `sed` and `ls`, ending on an
  `ls` of an absent `.claude`, `.env*` and `.mcp.json`, and each showed "Exit
  code 1". The skill now reads with Read and Glob and runs one unchained
  command per Bash call.
- `init` offered the literal `src/checkout.mjs`, with the spec, as the ground,
  which leaves a new file beside it unjudged, and the same file for
  `docDrift.entries`. A named file now puts its directory's glob (`src/**`)
  ahead of it among the ground's options; the drift proposal is unchanged.
- The spec gaps the arbiter named on both branches.
  `examples/consent/docs/spec.md` § Analytics now states
  `checkout(cart, user, { consent, track })` and the event, `"checkout"` with
  `{ user, total }`, and `fixed.patch` tests `{ analytics: "yes" }`.

These four changes were made after the trial. The marketplace install below
ran the example's two; `init`'s two were proved on 2026-11-21, below.

### The marketplace install, 2026-11-20

Claude Code 2.1.329, on a machine where docrank had never been installed and
no docrank marketplace added, in `~/docrank-trial`, an empty repository made
with `git init`.

- `/plugin marketplace add nacorga/docrank` (13:56:24Z): "Added marketplace:
  docrank".
- `/plugin install docrank@docrank` at Project scope (13:56:49Z): "✓ Installed
  docrank. Plugin is now active." The repository's `.claude/settings.json`
  became `{"enabledPlugins": {"docrank@docrank": true}}`.
- The minimum configuration is that and nothing else: the trial repository has
  no `.claude/docrank.json`, the demo carrying its own.

The demo, from `/docrank:demo` to the re-check:

- `/docrank:demo` (13:57:00Z) printed what `scripts/demo.mjs` printed at
  0.2.0. Its session command named the installed copy, version 0.2.0:
  `--plugin-dir ~/.claude/plugins/cache/docrank/docrank/0.2.0`.
- In the session opened in `repo-tracking` with that command, `/docrank:gates`
  passed `test` and recorded `42317e307`. Doc drift on `Stop` did not fire:
  the example sets no `docDrift.entries`.
- The prompt asking for the arbiter also held the demo's 0.2.0 hint for step
  2, to look for a `code defect` citing the spec's § Analytics. The session
  passed it to the arbiter as what to check, not as a conclusion.
- `docrank:spec-arbiter` reported four `code defect`s, each citing
  `examples/consent/docs/spec.md` § Analytics by line: the event sent without
  consent, the event carrying the email, the signature leaving out `consent`,
  and the test copying the defect with no case without consent. No spec gap.
- Told to review `demo/fixed`, the session ran `git checkout demo/fixed` and
  sent the re-check by `SendMessage` to the same arbiter. Verdict: the four
  resolved, the `{ analytics: "yes" }` case among them; "No findings",
  `Judged: ca4d9d1`. `npm test` 4/4.
- 5 min 14 s wall clock from `/docrank:demo` (13:57:00Z) to the verdict on
  `demo/fixed` (14:02:14Z), and 5 min 50 s from `marketplace add`, read from
  the sessions' transcripts.

This install proved live the example's two changes made after the previous
trial: no `docDrift.entries`, and the spec stating the call and the event with
`fixed.patch` testing `{ analytics: "yes" }`. `init`'s two, reading with Read
and Glob and offering a named file's directory glob first, were not exercised
here; they were proved on 2026-11-21, below.

Changed after it: each step the demo prints is now only what to type, alone on
its line, and what to expect is a block after the steps, since a pasted step
carried its hint to the judge. That output was proved on 2026-11-21, below.

### 0.2.1 and 0.2.2, 2026-11-21

Claude Code 2.1.330. Claude, the orchestrating session, drove every session
through tmux, typing into real interactive sessions; no human read or
answered, so the times below hold no reading time.

- `claude plugin update docrank@docrank`, in `~/docrank-trial` as the
  marketplace install above left it: "Plugin "docrank" updated from 0.2.0 to
  0.2.1 for scope project (~/docrank-trial)".

The demo, from `/docrank:demo` to the re-check:

- `/docrank:demo` in `~/docrank-trial` (10:36:51Z) printed the steps as a
  block, "Then type, one at a time, each line as it is:", of three bare lines,
  and what to expect as a separate block, "What to expect…". Its session
  command named `~/.claude/plugins/cache/docrank/docrank/0.2.1`.
- In the session opened in `repo-tracking` with that command, each step typed
  alone: `/docrank:gates` passed `test` and recorded `bf2c3d2`. Doc drift on
  `Stop` did not fire.
- With no hint in the prompt, `docrank:spec-arbiter` reported three `code
  defect`s, each citing `examples/consent/docs/spec.md` § Analytics by line:
  the event carries the email; there is no consent check, the signature taking
  no `consent`; the test asserts the forbidden behaviour. Beside them, a note:
  the spec does not say what happens when `track` is passed without `consent`.
- The re-check on `demo/fixed`, sent to the same arbiter, resumed: the three
  resolved and nothing new. Two `Late` notes, not findings: `consent: null`
  throws a TypeError, and two defaults, the no-op `track` and an absent
  `consent` meaning no consent, are not written in the spec.
- 3 min 56 s from `/docrank:demo` (10:36:51Z) to the verdict on `demo/fixed`
  (10:40:47Z).

This proved live the demo's step output changed after the marketplace install.

Fact 16's unproved half, a hook in a session started in a worktree:

- With that session still open in `repo-tracking`, on `demo/fixed`, a `!`
  command added `docDrift.entries`, `src/` paired with `docs/spec.md`, to
  `repo-tracking/.claude/docrank.json` only; the main checkout's
  `repo/.claude/docrank.json` had none, which was checked.
- The turn that followed (2.1.330 answers the output of a `!` command) ended
  with the `Stop` hook: "Code a document states changed, and the document did
  not: - src/ changed; docs/spec.md did not", "This hook comes from the
  docrank@inline plugin."

So the hook read the configuration of the worktree the session was started
in (§ 16).

`/docrank:init` with 0.2.1, `--plugin-dir` the installed 0.2.1, in a copy of
`examples/consent` with no `.claude/`, no sentence stating a rank in
`docs/spec.md` nor in `CLAUDE.md`, and a bare remote with no `origin/HEAD`:

- It read files with Read and ran one git command per Bash call.
- It asked which document binds, `docs/spec.md` recommended, `CLAUDE.md` and
  `None`: `docs/spec.md`. For the ground it offered `src/**`, recommended as
  the named file's directory, ahead of `src/checkout.mjs` and `**`: `src/**`.
- It proposed `docDrift.entries` `[{ "code": ["src/"], "docs":
  ["docs/spec.md"] }]` with `docs.precedence` and `judges.routes`; `docrank
  config` loaded it, and `docrank judges` showed the arbiter as `skip`.
- It installed the pre-push in `.git/hooks` and tried it: 0, then 1.

This proved live the three changes to `init`'s wording of 0.2.0 and 0.2.1:
Read and one unchained command per Bash call, a named file's directory glob
ahead of it for the ground, and its directory for doc drift.

Four errors remained, each a probe of something absent: `git symbolic-ref
refs/remotes/origin/HEAD` (exit 128, which the skill prescribed), a Read of
the absent `.claude/docrank.json` and of the absent `.git/hooks/pre-push`, and
`git config --get core.hooksPath`, unset (exit 1). Changed in 0.2.2: absence
is read from a Glob or a listing, `git branch --all` for the remote's default,
Glob before a Read, `git status --short --ignored` for ignored env files and
`git rev-parse --git-path hooks` for the hooks directory.

`/docrank:init` with 0.2.2, the same driver, in a fresh copy that also holds a
git-ignored `.env`. The plugin was loaded with `--plugin-dir` from the
`fix/0.2.2` branch at `2d887aa`, not from the released 0.2.2, whose content is
that commit's tree.

- No error in the session. Its calls: Read for `docs/config.md` and six files,
  `git branch --all`, `git remote -v`, `git ls-files`, `git status --short
  --ignored` (it showed `!! .env`), `git rev-parse --git-path hooks`, `git
  ls-files --others --exclude-standard`, `ls .git/hooks`.
- The same questions, answers and proposal. It installed the pre-push,
  identical to the template, and tried it.
- The install step chained `cp && chmod && ls && cmp` in one Bash call, once:
  no error, but a chain.

### docrank watch 0.3.0, 2026-11-23

Claude Code 2.1.330, model Fable 5.2, an interactive session in tmux driven
by Claude, the plugin loaded with `--plugin-dir` from `main` at `8dd9971`
(0.3.0), in `repo-tracking` as `scripts/demo.mjs` builds it. Its
`.claude/docrank.json` had `"watch": { "enabled": true, "language": "es",
"port": 47199 }`; the environment `CLAUDE_CODE_ENABLE_TODO_TOOLS=1
DOCRANK_WATCH_NO_OPEN=1`; permissions asked. One prompt: three tasks with
the task tools, then an Explore helper summarising `docs/spec.md`,
`/docrank:gates`, and `git push origin HEAD:main` once. The page was read in
a headless Chrome over the DevTools protocol, not by a person.

- The `SessionStart` hook started the server on 47199, `server.json` 0600,
  and opened no tab.
- The session's log, 52 lines: `SessionStart` 1, `UserPromptSubmit` 3,
  `PreToolUse` 16, `PostToolUse` 15, `TaskCreated` 3, `SubagentStart` 2,
  `SubagentStop` 5 (three for agents that never started, which the reducer
  ignores), `PermissionRequest` 1, `Notification` 1 (`permission_prompt`, six
  seconds after the request, as fact 18), `Stop` 3, `Refused` 1 and
  `SessionEnd` 1 (`prompt_input_exit`, on leaving the session). No secret-like
  value was produced, and none is in the log. It is
  `test/fixtures/watch-trial-0.3.0.jsonl`, its absolute paths made generic.
- The header read "Esperando tu permiso" while the `Skill(docrank:gates)`
  prompt was open and "Esperando tu respuesta" once the turn ended.
- The three tasks read Hecha, En curso and Hecha as they went; the Explore
  helper hung under task 1 with its errand "Resumir docs/spec.md"; the gate
  run read "Pasar todas las comprobaciones" in the gates helper.
- `guard-bash` refused the push; the page read "Intentó enviar el trabajo al
  repositorio compartido (push); una regla de seguridad lo impidió", the
  command and the `BLOCKED` message folded behind "detalle".

Fixed in 0.4.0 (0.3.1 was never released), each found here:

- The graph was framed on part of the nodes, or none, on some loads, and the
  Claude node and its edges were missing. The page rebuilt its nodes on every
  event without the sizes React Flow had measured, so each update made every
  node new and unmeasured: hidden until measured again, and left out of a
  fit. The sizes are now kept; a sampled load shows no hidden node and a fit
  on each added node.
- `/docrank:gates` runs forked: its helper's `SubagentStart` (type
  `general-purpose`) followed a `Skill` call, not an `Agent` call, so it read
  "un encargo sin nombre". A `Skill` call is now an errand too (fact 23).
- The session list named the repository by its directory key ("repo"), the
  header by the checkout ("repo-tracking"); both now name the checkout.

Not proved: the tab opening by itself (suppressed here), a person reading
the page, Linux.

### docrank watch 0.4.0, 2026-11-23

Claude Code 2.1.330, model Opus 5.5, an interactive session in tmux driven
by Claude, the plugin loaded with `--plugin-dir` from `main` at `c71127f`
(0.4.0), in the demo's worktree on `demo/tracking`, with the same `watch`
configuration and environment as the 0.3.0 trial and permissions in auto
mode. The 0.3.0 trial's server had stopped itself after its idle timeout.
One prompt: three tasks with the task tools, an Explore helper listing
`src/` and `test/`, `/docrank:gates`, and a comparison of
`src/checkout.mjs` with `docs/spec.md`. The page was read in a headless
Chrome over the DevTools protocol, not by a person.

- The `SessionStart` hook started a protocol-2 server on 47199.
- The session's log, 67 lines: `SessionStart` 1, `UserPromptSubmit` 4,
  `PreToolUse` 22, `PostToolUse` 22, `TaskCreated` 3, `SubagentStart` 3
  (the Explore helper twice: `SendMessage` resumed it, and the page kept one
  card for it), `SubagentStop` 7 (four for agents that never started, which
  the reducer ignores), `Stop` 4 and `SessionEnd` 1 (`prompt_input_exit`,
  again). It is `test/fixtures/watch-trial-0.4.0.jsonl`, its absolute paths
  made generic.
- Three of the four `UserPromptSubmit` lines (24, 38, 56) carried no human
  prompt: each came as a background helper finished, its result delivered to
  Claude as a new turn. The prompt is not stored, so the reducer cannot tell
  them apart, and need not: Claude works on each, so *working* is right.
- The sessions list showed both sessions under the repository, the live
  one first ("Trabajando · 3 tareas") and the 0.3.0 trial's ("Terminado ·
  3 tareas"); after the turn the live one read "Esperando tu respuesta".
- Scrubbing the live session while it wrote: the slider at step 21 of 64
  drew the graph as it stood then (task 1 in progress, its Explore helper
  working, tasks 2 and 3 to do) while the log grew from 56 to 66 lines.
- Opening the 0.3.0 session and pressing "Reproducir" played it back
  ("Pausa · paso 18 de 52" about seven seconds later).

Fixed in 0.4.1, found here:

- A turn ended while its helper still worked: `Stop` at line 20, the
  Explore helper's `SubagentStop` only at line 26. Until the helper's next
  call the header and the sessions list read "Esperando tu respuesta" while
  Claude waited for its helper. The reducer now counts the helpers started
  and not stopped; while one runs the session is *working*. A helper's own
  calls no longer undo the turn's `Stop` either, so once the last one stops
  the session waits for an answer until a prompt, a call or a helper says
  otherwise. The 0.3.0 log had the same moment at line 34, unnoticed then.

Not proved: a protocol-1 server replaced live (the old one had already
stopped; unit-tested only), the daily retention timer, the tab opening by
itself, a person reading the page, Linux.

## 16. Install scopes, `--plugin-dir`, a session in a worktree: VERIFIED

**Scopes.** [plugins] § Understand install scopes: "**User scope**: enabled
for you in every project on this computer", "**Project scope**: enabled for
everyone who works in this repository, through the committed
`.claude/settings.json`", "**Local scope**: enabled for you in this repository
only". [loading] § Find where a plugin is enabled gives the file each scope
writes and whom it reaches: `user` | `~/.claude/settings.json` | "You, in
every project"; `project` | `.claude/settings.json` | "Everyone who clones the
repository"; `local` | `.claude/settings.local.json` | "You, in this
repository only". So a plugin installed at project or local scope in one
repository is not enabled in a session started in a new directory outside it,
which has neither file; one installed at user scope is.

**`--plugin-dir` beside an install.** [plugin-cli] § Flags that load a plugin
for one session: "Two `claude` flags load a plugin for one session only,
without installing it." [loading] § Name conflicts ranks "An enabled
`--plugin-dir`, `--plugin-url`, or `CLAUDE_CODE_PLUGIN_DIRS` plugin" above "An
installed marketplace plugin", which it replaces: "**An installed marketplace
plugin**: replaced silently. `claude plugin list` still shows the marketplace
row as enabled". The order "compares manifest names", and only one source
ranks higher: "A plugin whose id appears in managed settings `enabledPlugins`
... A `--plugin-dir` copy whose manifest name matches the id's name part isn't
loaded". So `claude --plugin-dir <plugin root>` loads that copy of docrank
whatever scope it is installed at, or whether it is installed at all, unless
an organization's managed settings name docrank.

**A session started in a worktree.** [permissions] § Working directories:
"Claude has access to files in the directory where you launched it. That
directory is the session's primary working directory". [settings]: "Claude
Code reads the shared `.claude/settings.json` from the session's primary
working directory"; the local file is the exception: "In a worktree, it uses
the file at the main checkout's root". [worktrees] § What worktrees share with
the main checkout: "In a worktree with its own `.claude/skills` directory,
only that copy loads. The same read-through covers `.claude/agents` and
`.claude/commands`", and "All of these apply whether you create the worktree
with `--worktree` or with `git worktree add`".

`.claude/docrank.json` is not read by Claude Code but by docrank, at the git
top level of the hook input's `cwd` (`lib/hook.mjs` `configFor`). [hooks]
§ Common input fields: "`cwd` | Current working directory when the hook is
invoked"; that it is the launch directory in a session started there is read
from the primary working directory above, not from a page that states both.
The demo (`scripts/demo.mjs`) does not depend on it: its patches never touch
`.claude/docrank.json`, so the worktree and the main checkout hold the same
file. PROVED LIVE on 2026-11-21 (§ 15), still not documented: with
`docDrift.entries` in the worktree's `.claude/docrank.json` only, doc drift
fired on `Stop` in a session started in the worktree, so the hook read the
configuration of the worktree the session was started in.

## 17. The events watch reads and their inputs: VERIFIED

[hooks] § Hook lifecycle lists, among others: "`PreToolUse` | Before a tool
call executes", "`PermissionRequest` | When a tool call needs a permission
decision", "`PermissionDenied` | When auto mode denies a tool call",
"`PostToolUse` | After a tool call succeeds", "`PostToolUseFailure` | After a
tool call fails", "`Notification` | When Claude Code sends a notification",
"`SubagentStart` | When a subagent is spawned", "`SubagentStop` | When a
subagent finishes", "`TaskCreated` | When a task is being created via
`TaskCreate`", "`Stop` | When Claude finishes responding", "`SessionStart` |
When a session begins or resumes", "`UserPromptSubmit` | When a prompt is
submitted, before Claude processes it" and "`SessionEnd` | When a session
terminates".

Inputs, each besides the common fields (`session_id`, `cwd`,
`hook_event_name`, …):

- `PreToolUse`: "receive `tool_name`, `tool_input`, and `tool_use_id`". For
  `Agent`, `tool_input` holds `prompt`, `description`, `subagent_type`,
  `model`.
- `PostToolUse`: "both `tool_input`, the arguments sent to the tool, and
  `tool_response`, the result it returned", with `tool_use_id` in the
  example. [sdk-ts] § `PostToolBatchHookInput`: its `tool_response` "differs
  from `PostToolUseHookInput`'s structured `Output` object", so
  `PostToolUse` carries the tool's structured output (fact 22 for
  `TaskCreate`).
- `PostToolUseFailure`: "the same `tool_name` and `tool_input` fields as
  PostToolUse, along with error information as top-level fields", `error`
  and `is_interrupt`, `tool_use_id` in the example. It "doesn't fire for tool
  calls rejected before execution ... Permission denials fire `PreToolUse`
  but not this event".
- `PermissionRequest`: "`tool_name` and `tool_input` fields like PreToolUse
  hooks, but without `tool_use_id`". "Use this event when you need a signal
  the moment Claude asks for permission to use a tool."
- `PermissionDenied`: "`tool_name`, `tool_input`, `tool_use_id`, and
  `reason`".
- `SubagentStart`: "`agent_id` with the unique identifier for the subagent
  and `agent_type`". It fires "when Claude spawns a subagent with the Agent
  tool, when Claude resumes a subagent, and each time an in-process agent
  team teammate handles a new message".
- `SubagentStop`: "`stop_hook_active`, `agent_id`, `agent_type`,
  `agent_transcript_path`, and `last_assistant_message`"; it also fires for
  Claude Code's internal agents, whose `agent_type` can be "an empty string".
- `TaskCreated`: "`task_id`, `task_subject`, and optionally
  `task_description`"; "In a session without the Task tools, this event
  doesn't fire."
- `Stop`: "Does not run if the stoppage occurred due to a user interrupt."
- `UserPromptSubmit`: "the `prompt` field containing the submitted text";
  it also fires for scheduled tasks and "A background subagent reporting
  back to the session that started it".
- `SessionEnd`: a `reason` field.
- Inside a subagent: "tool events such as `PreToolUse` and `PostToolUse` fire
  the same configured hooks as in the main conversation, and the input
  carries the `agent_id` and `agent_type` common input fields that identify
  the subagent" (§ Hook locations).

The match-all matcher is fact 14: "`"*"`, `""`, or omitted | Match all".
`PostToolUse` § says the same for the event: "To run a hook after any tool
completes successfully, omit the `matcher` or set it to `"*"`".

That a plugin may wire `SessionEnd` is NOT DOCUMENTED per event, as fact 3.
Watch wires it and keeps an idle timeout for a session that sends none.

## 18. `Notification` types, the two waiting states: VERIFIED, with their delays

[hooks] § Notification input: "`message` with the notification text, an
optional `title`, and `notification_type` indicating which type fired". Its
values include "`permission_prompt` | Claude needs you to approve a tool use
... and the prompt has waited about six seconds" and "`idle_prompt` | Claude
finished responding about 60 seconds ago and you haven't typed since". In a
terminal the six seconds are reset by typing: "Expect `permission_prompt`
once you haven't typed for about six seconds"; and `idle_prompt` comes "only
if you haven't typed since and no background agent ... is still running".
For sessions hosted through `canUseTool`, "Before v2.1.233,
`permission_prompt` didn't fire in these sessions."

So `permission_prompt` is late by design; `PermissionRequest` (fact 17) is
the immediate signal, and watch reads both. *Waiting for an answer* starts
on `Stop`, which comes at once, and `idle_prompt` only confirms it.

## 19. `async: true` on a command hook, from a plugin: VERIFIED; for a plugin, by its shape only

[hooks] § Command hook fields: "`async` | no | If `true`, runs in the
background without blocking". § Run hooks in the background: "Async hooks
can't block or control Claude's behavior: response fields like `decision`,
`permissionDecision`, and `continue` have no effect"; "Once an async hook is
running in the background, Claude Code doesn't enforce `timeout` on it";
"Each execution creates a separate background process"; and "In
non-interactive mode with the `-p` flag, Claude Code kills any async hook
still running at teardown ... If your hook's work must outlive a `claude -p`
session, start a fully detached process from it".

For a plugin: [components] § Hooks, plugin hooks go in `hooks/hooks.json`
"in the same shape as the `hooks` object in `settings.json`" (fact 3), and
[components] points to [hooks] "For every event and its payload". No page
names `async` for a plugin hook, and none excludes it. Without it the hook
would run synchronously; it still exits 0 at once when watch is off, so the
cost is one short Node process per event.

Separate processes mean no order between them: a fast tool's `PostToolUse`
line can be written before its `PreToolUse` line. The reducer pairs by
`tool_use_id` and accepts either order.

## 20. A hook that fails or times out does not block: VERIFIED

[hooks] § Exit code output: "**Non-blocking error**: your hook exits with any
other code, or fails in some other way, such as not starting or printing
invalid JSON. The action goes ahead, except for hooks whose failure blocks the
action, for example a hook with `onFailure` set to `"block"`". § Timeouts:
"On `PreToolUse`, a timed-out `command`, `http`, or `mcp_tool` hook doesn't
block the tool call, except for hooks whose failure blocks the action".
§ Block the action when a hook fails: `onFailure` "has no effect on ...
**Background command hooks**: command hooks that set `async` or
`asyncRewake`". Fail-open is the default, and an async hook cannot be made to
fail closed.

## 21. A `PreToolUse` hook's refusal fires no other event: VERIFIED

[hooks] § PermissionDenied: it "Runs when the auto mode classifier denies a
tool call" and "The hook doesn't run when you deny a permission dialog, when
a `PreToolUse` hook blocks a call, or when a `deny` rule matches".
§ PostToolUseFailure: "Permission denials fire `PreToolUse` but not this
event". Hooks of one event run in parallel (§ Hook handler fields: "When an
event fires, its matching hooks run in parallel"), so the watch hook cannot
see what a guard decided. A docrank guard that refuses writes the refusal to
the watch log itself; a refusal by any other hook, a deny rule or the user
leaves an action with no outcome.

## 22. The task tool sets and their shapes: VERIFIED; off by default on newer models

[tools]: "`TodoWrite` | Manages the session task checklist. Disabled by
default in favor of `TaskCreate`, `TaskGet`, `TaskList`, and `TaskUpdate`.
Set `CLAUDE_CODE_ENABLE_TASKS=0` to re-enable it". § Task tool availability:
"The task-tracking tools ... are available by default only on Opus 4.7,
Sonnet 4.6, Haiku 4.5, and earlier models" and "On every other model, Claude
Code leaves the tools out unless you opt in", among others by "Export
`CLAUDE_CODE_ENABLE_TODO_TOOLS=1` before you start Claude Code". "A subagent
has the task-tracking tools only when your session has them".

Shapes, [sdk-ts] § Tool Input Types and Tool Output Types:
`TaskCreateInput = { subject: string; description: string; activeForm?:
string; metadata?: ... }`; `TaskUpdateInput = { taskId: string; status?:
"pending" | "in_progress" | "completed" | "deleted"; subject?: string; ...
activeForm?: string; ... }`; `TaskCreateOutput = { task: { id: string;
subject: string; }; }`; `TodoWriteInput = { todos: Array<{ content: string;
status: "pending" | "in_progress" | "completed"; activeForm: string; }>; }`.
[sdk-todo]: "Claude Code repairs some close-but-incorrect key names before
execution, mapping `id` or `task_id` to `taskId` and `active_form` to
`activeForm`, but that repair is not reflected in the stream. Read
`TaskUpdate` input fields defensively". `TaskCreated` (fact 17) carries
`task_id` and `task_subject` as well.

So on the models without the tools, the default today, a session has no task
list and watch groups its work by turn, one per prompt.

## 23. A helper's errand; a non-interactive session: errand by order, the rest NOT DOCUMENTED

`SubagentStart` carries no description (fact 17). The errand is the
`description` of the `Agent` call that spawned it, matched by order: the
oldest `Agent` call of the same `subagent_type` that no helper has taken yet,
else the oldest of any type. `SubagentStart`'s `agent_id` is the new
helper's own, so which agent spawned it is not known either. An id match is NOT DOCUMENTED: the `Agent` response's
`agentId` example is `"a4d2c8f1e0b3a297"`, the `SubagentStart` example's
`agent_id` is `"agent-abc123"` (fact 12), and a foreground `Agent` call's
`PostToolUse` arrives only when the helper has finished.

A skill with `context: fork` (fact 10) starts a helper with no `Agent` call:
in the watch trial (§ 15) `/docrank:gates`'s `SubagentStart`, type
`general-purpose`, followed the `Skill` call's `PreToolUse` and preceded its
`PostToolUse` by 13 ms. A `Skill` call is therefore an errand too, the
skill's name: a helper takes the oldest `Agent` call of its type, else the
oldest `Skill` call, else the oldest `Agent` call of any type. A skill that
ran inline leaves its `Skill` call untaken; it is forgotten at `Stop` or the
next prompt, and until then a helper with no call of its own takes it. A
helper whose `SubagentStart` line lands before its call's (async hooks,
fact 19) gets no errand.

No hook input field says the session is non-interactive (`-p`): [hooks]
§ Common input fields lists none, and § SessionStart input has `source`,
`model`, `agent_type` and `session_title` only. Watch opens no tab under `CI`
or `SSH_CONNECTION` and does not tell a `-p` run apart.

## 24. `transcript_path` in the hook input, and the shape of a transcript line: path VERIFIED; shape NOT DOCUMENTED

`guard-message` with `messages.evidenceHeader` reads what the session wrote
this turn from the session transcript. The path is documented: [hooks]'s
notification example carries `"transcript_path":
"/Users/.../.claude/projects/.../00893aaf-....jsonl"`, and fact 9 takes it as
the field "every hook receives". [claude-dir] names the file's format by the
subagents' copy: "Subagent transcripts in the same format as the session
transcript", each stored as `.jsonl`.

What a line holds is NOT DOCUMENTED. `hooks/guard-message.mjs` reads one JSON
object per line with a `type` of `user` or `assistant`, a `message.content`
that is a string or an array of blocks (`text`, `tool_use`, `tool_result`),
and optional `isSidechain`, `isMeta`, `isCompactSummary` and
`origin.kind`. A real prompt is a `user` entry whose content is a string or
holds a `text` block, that is not `isMeta` and whose `origin.kind`, when
`origin` is present, is `human`; a tool's answer is a `user` entry whose
blocks are all `tool_result`. Observed in Claude Code 2.1.x transcripts, also
as `user` entries with string content: a background task's notification
(`origin.kind` `task-notification`), a subagent's hand-back or a peer message
(`isMeta: true`, `origin.kind` `peer`) and the compaction summary
(`isCompactSummary: true`, no `origin`). An entry with no `origin`, as in older
versions and the summary, still counts as a prompt: the guard errs toward
asking for the table again. A local transcript read on 2026-11-23 had that
shape (`user` with a string content, `user` with `tool_result` blocks,
`assistant` one entry per `text` block), which is an observation of one
version, not a contract. So the guard decides on evidence only when it can
read the file and finds a line it understands, and a transcript that is
absent, unreadable, holds a line that is not JSON, or holds no user prompt
makes it fall back to refusing once per input, as without the key.

## 25. `CLAUDE_CODE_ENABLE_TODO_TOOLS` in a repository's `env`: the `env` VERIFIED; the task tools from it NOT DOCUMENTED

`init` offers to turn the task tools (fact 22) on for a repository by writing
the variable into the `env` of its `.claude/settings.json`.

[env-vars] § Set variables in settings files: "Add variables under the `env`
key in a `settings.json` file, creating the file if it doesn't exist. Claude
Code reads them directly from the file, so they take effect no matter how
`claude` was launched", its table naming "`.claude/settings.json` | Everyone
working in the project, checked into source control"; and "a feature that
reads its variables once at startup, such as OpenTelemetry monitoring, keeps
its startup values until you relaunch". The variable's row: "Set to `1` to
get the task-tracking tools on every model. ... Requires Claude Code
v2.1.233 or later".

[settings-ref] § When Claude Code applies `env` values: "From project and
local settings: after you trust the workspace, or at startup in `-p` mode,
which never shows the trust dialog" and "Variables Claude Code classifies as
safe, such as model selection, timeouts and limits, and feature toggles: at
startup from every settings file, apart from the variables project and local
settings can't set". `CLAUDE_CODE_ENABLE_TODO_TOOLS` is not in § Variables
Claude Code ignores in `env`. [settings] § A committed key doesn't reach teammates: "most `env` values
apply only after each teammate trusts the folder".

[tools] § Task tool availability gives the way as "Export
`CLAUDE_CODE_ENABLE_TODO_TOOLS=1` before you start Claude Code", and
§ Task-tracking tools in subagents and agent teams sets it through a
settings `env` block: "start your session by running `claude --settings
'{"env":{"CLAUDE_CODE_ENABLE_TODO_TOOLS":"1"}}'` in your shell". A
`--settings` file's `env` applies "at startup".

Not documented: whether the variable is one Claude Code "classifies as safe"
and applies at startup from a project file, and whether the session's tool
set, chosen at its start, follows a value applied only once the workspace is
trusted. Not proved live. So `init` says the setting is unproved from a
repository file, that it takes effect from the next session started in the
repository, and that exporting the variable before `claude` is the
documented way.
