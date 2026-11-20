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

| # | Fact | Status |
|---|---|---|
| 1 | `${CLAUDE_PLUGIN_ROOT}` works in hook commands | VERIFIED |
| 2 | A plugin can wire `WorktreeCreate` | VERIFIED, with two limits; PROVED LIVE |
| 3 | A plugin can wire `Stop` and `SessionEnd` | NOT DOCUMENTED per event; `Stop` PROVED LIVE |
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
| 16 | Where an installed plugin is on; `--plugin-dir` beside an install; a session started in a worktree | VERIFIED; that a hook's `cwd` is the launch directory, inferred |

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
blocked a session's end with its message. `SessionEnd` is not wired by docrank.

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
file. Not proved live yet.
