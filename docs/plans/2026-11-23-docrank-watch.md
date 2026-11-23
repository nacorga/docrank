# docrank watch — the plan

## Context

A live view of what a Claude Code session is doing, for an observer who does
not read a terminal: a browser tab that turns the session's tool calls into
plain sentences, grouped under the tasks Claude is working on and the helpers
(subagents) it dispatched. Decided with the user on 2026-11-23:

- **Audience and place**: a non-technical observer, in a local browser tab
  served on `127.0.0.1` (shared screen included). Nothing leaves the machine.
- **Start**: automatic, by a key in `.claude/docrank.json`. One server shared
  by every session on the machine, on a fixed configurable port; the first
  session with the key on starts it, the others join, and it stops itself a
  while after the last live session. `docrank watch` opens it without a
  session.
- **Data**: hooks only. The transcript is not read (facts 8 and 9 are NOT
  DOCUMENTED), so Claude's prose and the user's prompt do not appear.
- **View**: a React Flow graph, Claude → tasks (the current one highlighted)
  → helpers, each helper a card under the task it was dispatched in. Actions
  are not nodes: they are a plain-language feed in the active node, the exact
  command or path folded behind "detail". A guard's refusal reads as a plain
  warning ("tried to push without the tests passing; it was stopped").
- **Language**: `en` and `es`, by a key, `en` by default.
- **History**: kept on disk outside the repository, grouped by repository,
  with limited retention; a past session opens in its final state with a
  timeline to move through it and play it back.
- **Where**: inside docrank. React and React Flow are dev dependencies; an
  esbuild bundle is committed, so the Node side keeps no run-time dependency.
  `CLAUDE.md` and the README change to admit that bundle and its build.

Agreed after a review of gaps: the observation hook fails open; tasks come
from either task tool set, with a "work without a list" node when there is
none; the observer sees *working*, *waiting for permission*, *waiting for an
answer* and *done*; the history redacts secrets and keeps no tool output;
the server takes a random token in its URL and checks `Host`; one pure
reducer turns events into the graph for both the live view and the
timeline; the live view ships first, the history second.

### Harness facts this rests on

Read on 2026-11-23 from [hooks], [tools] and
https://code.claude.com/docs/en/agent-sdk/todo-tracking.md through a
summarizer; slice 1b re-reads each one and records it with its exact quote.

- Events exist for `PreToolUse`, `PostToolUse`, `PostToolUseFailure`,
  `PermissionRequest`, `PermissionDenied`, `Notification`, `SubagentStart`,
  `SubagentStop`, `TaskCreated`, `TaskCompleted`, `Stop`, `SessionStart` and
  `SessionEnd`, among 33.
- `Notification` carries `notification_type`, with `permission_prompt` and
  `idle_prompt` among its values: the two waiting states. `permission_prompt`
  did not fire in some sessions before v2.1.233.
- A command hook takes `async: true` ("runs in the background without
  blocking"); its timeout is not enforced. That a plugin's `hooks.json`
  honours it is NOT DOCUMENTED until 1b reads it.
- A hook that exits non-zero (other than 2), prints invalid JSON or times out
  does not block the tool, unless it sets `onFailure: "block"`: fail-open is
  the default.
- `"*"`, `""` or no matcher matches every tool.
- `tool_use_id` reaches `PreToolUse`, `PostToolUse`, `PostToolUseFailure`
  and `PermissionDenied`, not `PermissionRequest`. A hook fired inside a
  subagent carries `agent_id` and `agent_type`. `SubagentStart` carries
  `agent_id` and `agent_type` only, no description: a helper's errand is the
  `description` of the `Agent` call that preceded it, matched by order — a
  heuristic, stated as such in the code.
- `TodoWrite` is "Disabled by default in favor of `TaskCreate`, `TaskGet`,
  `TaskList`, and `TaskUpdate`" (`CLAUDE_CODE_ENABLE_TASKS=0` brings it back),
  and the Task tools are on by default only on some models. `TaskCreate`
  takes `subject` and `activeForm`; `TaskUpdate` takes `taskId` and `status`
  (`pending`, `in_progress`, `completed`, `deleted`); the result of
  `TaskCreate` is `{ task: { id, subject } }`. `TodoWrite`'s input shape is
  NOT DOCUMENTED: it is read defensively, and an unreadable call falls back to
  "work without a list".

## How the work runs

- The plan is versioned in English in the first PR, checked slice by slice,
  and leaves the tree when done.
- Each slice has its own branch and worktree, cut from an up-to-date
  `origin/main`, and a PR against `main`. Merges, tags, releases and live
  trials are the user's.
- Each slice is built by a fresh subagent, briefed from this plan,
  `CLAUDE.md` and the memory index; fix rounds resume it.
- Conventional commits with a scope and the session's `Co-Authored-By` line.
- A slice closes with its evidence (tests, green CI, a screenshot of the tab)
  before the next starts.

## Slices

### [ ] 1 · The live view — branch `feat/watch-live`

- [x] **1a · The plan enters the tree.** Commit `docs: plan docrank watch`.
- [ ] **1b · Harness facts.** Re-read [hooks] and [tools] and record as new
  facts in `docs/harness-facts.md`, each VERIFIED with its quote or NOT
  DOCUMENTED: the events above and their inputs, `notification_type`'s
  values, `async` (and whether plugin hooks honour it), fail-open on error
  and timeout, the match-all matcher, the two task tool sets and their
  shapes. Whatever turns out NOT DOCUMENTED gets a fallback in this plan
  before 1d starts.
- [ ] **1c · Config.** A `watch` section in `lib/config.mjs` and
  `docs/config.md`, together: `watch.enabled` (bool, `false`),
  `watch.port` (int, a fixed default above 1024), `watch.language`
  (`"en" | "es"`, `"en"`), `watch.retentionDays` (int, used by slice 2).
  The `doc-facts` test keeps the two in step.
- [ ] **1d · The observation hook.** `hooks/watch-event.mjs`, wired with
  `async: true` (if 1b allows it) on `PreToolUse`, `PostToolUse` and
  `PostToolUseFailure` with matcher `"*"`, and on `PermissionDenied`,
  `Notification`, `SubagentStart`, `SubagentStop`, `Stop` and `SessionStart`.
  - With `watch.enabled` off, or an invalid config, it exits 0 at once. It
    never refuses and never prints a decision: unlike the guards, it fails
    open, and its header says why.
  - It appends one JSON line per event to
    `~/.claude/docrank/watch/<repo key>/<session_id>.jsonl` (directory 0700,
    file 0600): time, event, `tool_use_id`, `agent_id`/`agent_type`, tool name,
    a redacted and length-capped summary of the input, success or failure,
    and from a response only what the graph needs (a task's id). No tool
    output is stored.
  - Redaction: env-file contents, `Authorization`/token/key/password-like
    assignments and URLs with credentials. Tests per pattern.
  - A `Bash` command that equals one of `gates.run` is tagged as that gate.
- [ ] **1e · The reducer.** `lib/watch/reduce.mjs`, pure ESM with no React,
  shared by the server tests and the bundle: events → `{ session state, tasks,
  helpers, feed per node }`.
  - Tasks from `TaskCreate`/`TaskUpdate` and from `TodoWrite`; actions before
    any task, or in a session without one, go to "work without a list".
  - `Pre`/`Post` paired by `tool_use_id`, parallel calls included; actions
    inside a helper by `agent_id`; a helper hangs from the task in progress
    when its `Agent` call was made.
  - State: *working*, *waiting for permission* (`permission_prompt`),
    *waiting for an answer* (`idle_prompt` or `Stop`), *done* (no event for
    the idle timeout or `SessionEnd` if 1b proves it).
  - Tested on recorded event sequences, one per case above.
- [ ] **1f · Plain sentences.** `lib/watch/phrases.mjs`, `en` and `es`: one
  sentence per built-in tool, by path or scope (`Read`, `Edit`, `Write`,
  `Glob`, `Grep`, `Bash`, `Agent`, `WebFetch`, task tools, …), gates by name,
  common Bash families (git, tests, install), a guard refusal as a warning,
  and a generic sentence for an unknown or MCP tool. Tests: each tool in
  both languages, the fallback, no raw secret in any sentence.
- [ ] **1g · The server.** `scripts/watch-server.mjs`, Node built-ins only:
  - `127.0.0.1` on `watch.port`; a random token in the URL, required on every
    request; `Host` must be `127.0.0.1:<port>` or `localhost:<port>`.
  - Serves the bundle and an SSE stream of new events per session, tailing
    the JSONL files.
  - Answers a version request; a session of another protocol version stops
    the old server and starts its own.
  - Stops itself after the idle timeout with no live session.
  - The `SessionStart` hook starts it detached when absent and opens the tab
    only when no tab is connected and not under `CI`, `SSH_CONNECTION` or a
    non-interactive session (how `-p` shows in the hook input is checked in
    1b; without a signal, `CI` and SSH only).
  - Tests: token and `Host` refused, SSE delivers an appended event, version
    mismatch, idle stop.
- [ ] **1h · The UI.** `ui/` (React, `@xyflow/react`), built by esbuild to
  `ui/dist/watch.js` and committed; `npm run build:ui`.
  - The graph from the reducer; the active node's feed; "detail" folded; the
    session state in plain words at the top; `en`/`es` from config.
  - A test builds the bundle in a temporary directory and fails when it
    differs from the committed one, so CI catches a stale bundle.
  - Checked in a real browser with a screenshot of a live session.
- [ ] **1i · CLI.** `lib/cli/watch.mjs`: `docrank watch` starts the server if
  needed and prints (and opens) the URL.
- [ ] **1j · Documents.** `docs/config.md` (1c); README: what watch shows,
  how to switch it on, what is stored and where; `CLAUDE.md`: the bundle, its
  build, the dev dependencies and that the Node side still has none.
- [ ] **1k · Version 0.3.0.** `package.json`, `package-lock.json`,
  `.claude-plugin/plugin.json`; `claude plugin validate .`.
- [ ] **1l · PR** «feat(watch): a live plain-language view of the session».
  CI green on the four combinations.
- [ ] **1m · Release and live trial (user).** Tag and release 0.3.0; one
  session with an observer reading the tab: tasks, a helper, a gate run, a
  guard refusal, a permission wait. Recorded in harness-facts § 15 and the
  README «What is proved live».

### [ ] 2 · History and timeline — branch `feat/watch-history`

- [ ] **2a · Retention.** The server deletes session files older than
  `watch.retentionDays` on start and daily; a test with dated files.
- [ ] **2b · Sessions list.** The tab lists sessions by repository, live ones
  first, each with its start, its state and its task count.
- [ ] **2c · Timeline.** A past session opens in its final state with a
  slider over its events and a play button; the graph at any point is the
  reducer over the events up to it. Tests on the reducer's prefixes.
- [ ] **2d · Documents and version 0.4.0**, PR, CI green.
- [ ] **2e · Release and live trial (user)**: an observer replays a session
  of slice 1's trial. Recorded as in 1m; this plan leaves the tree in the
  same PR.

[hooks]: https://code.claude.com/docs/en/hooks.md
[tools]: https://code.claude.com/docs/en/tools-reference.md
