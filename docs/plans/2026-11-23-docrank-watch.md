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

Recorded with their quotes as facts 17 to 23 of `docs/harness-facts.md`
(slice 1b, 2026-11-23). What they change against the leads this plan was
first written from:

- A refusal by a `PreToolUse` hook fires neither `PermissionDenied` nor
  `PostToolUseFailure` (fact 21), and the watch hook runs in parallel with
  the guards. Fallback: a docrank guard that refuses appends the refusal to
  the watch log itself, by `tool_use_id`. Other refusals (a deny rule, the
  user) leave the action without an outcome.
- `permission_prompt` comes only after about six seconds without typing
  (fact 18). `PermissionRequest` is the immediate signal and is wired too;
  either one means *waiting for permission*. `UserPromptSubmit` is wired so
  a new prompt ends *waiting for an answer*; the prompt is not stored.
- The Task tools and `TodoWrite` are off by default on every model newer
  than Opus 4.7, Sonnet 4.6 and Haiku 4.5 (fact 22): on those, "work without
  a list" is the usual graph, and the README says how to opt in
  (`CLAUDE_CODE_ENABLE_TODO_TOOLS=1`). `TodoWrite`'s input shape is
  documented after all (`todos[].content`, `status`, `activeForm`).
  `TaskCreated` carries `task_id` and `task_subject` and is wired as a
  second source of a task's id.
- `async: true` is documented for command hooks; for a plugin's
  `hooks/hooks.json` only by its shape (fact 19). Async hooks are separate
  processes, so a `PostToolUse` line can precede its `PreToolUse` line; the
  reducer accepts either order. Under `-p`, async hooks are killed at
  teardown: the server is started fully detached.
- A helper's errand stays matched by order (fact 23), narrowed to the
  oldest untaken `Agent` call of the same `subagent_type`. No hook input says a session is non-interactive: the tab is not
  opened under `CI` or `SSH_CONNECTION`, and `-p` is not told apart.
- `SessionEnd` from a plugin is NOT DOCUMENTED per event (fact 3): it is
  wired, and the idle timeout still ends a session that sends none.

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
- [x] **1b · Harness facts.** Re-read [hooks] and [tools] and record as new
  facts in `docs/harness-facts.md`, each VERIFIED with its quote or NOT
  DOCUMENTED: the events above and their inputs, `notification_type`'s
  values, `async` (and whether plugin hooks honour it), fail-open on error
  and timeout, the match-all matcher, the two task tool sets and their
  shapes. Whatever turns out NOT DOCUMENTED gets a fallback in this plan
  before 1d starts.
- [x] **1c · Config.** A `watch` section in `lib/config.mjs` and
  `docs/config.md`, together: `watch.enabled` (bool, `false`),
  `watch.port` (int, a fixed default above 1024), `watch.language`
  (`"en" | "es"`, `"en"`), `watch.retentionDays` (int, used by slice 2).
  The `doc-facts` test keeps the two in step.
- [x] **1d · The observation hook.** `hooks/watch-event.mjs`, wired with
  `async: true` on `PreToolUse`, `PostToolUse` and `PostToolUseFailure` with
  matcher `"*"`, and on `PermissionRequest`, `PermissionDenied`,
  `Notification`, `SubagentStart`, `SubagentStop`, `TaskCreated`,
  `UserPromptSubmit` (the prompt is not stored), `Stop`, `SessionStart` and
  `SessionEnd`. The docrank guards append their own refusals (fact 21).
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
- [x] **1e · The reducer.** `lib/watch/reduce.mjs`, pure ESM with no React,
  shared by the server tests and the bundle: events → `{ session state, tasks,
  helpers, feed per node }`.
  - Tasks from `TaskCreate`/`TaskUpdate` and from `TodoWrite`; actions before
    any task, or in a session without one, go to "work without a list".
  - `Pre`/`Post` paired by `tool_use_id`, parallel calls included; actions
    inside a helper by `agent_id`; a helper hangs from the task in progress
    when its `Agent` call was made.
  - State: *working*, *waiting for permission* (`PermissionRequest` or
    `permission_prompt`), *waiting for an answer* (`idle_prompt` or `Stop`),
    *done* (`SessionEnd`, or no event for the idle timeout).
  - Tested on recorded event sequences, one per case above.
- [x] **1f · Plain sentences.** `lib/watch/phrases.mjs`, `en` and `es`: one
  sentence per built-in tool, by path or scope (`Read`, `Edit`, `Write`,
  `Glob`, `Grep`, `Bash`, `Agent`, `WebFetch`, task tools, …), gates by name,
  common Bash families (git, tests, install), a guard refusal as a warning,
  and a generic sentence for an unknown or MCP tool. Tests: each tool in
  both languages, the fallback, no raw secret in any sentence.
- [x] **1g · The server.** `scripts/watch-server.mjs`, Node built-ins only:
  - `127.0.0.1` on `watch.port`; a random token in the URL, required on every
    request; `Host` must be `127.0.0.1:<port>` or `localhost:<port>`.
  - Serves the bundle and an SSE stream of new events per session, tailing
    the JSONL files.
  - Answers a version request; a session of another protocol version stops
    the old server and starts its own.
  - Stops itself after the idle timeout with no live session.
  - The `SessionStart` hook starts it detached when absent and opens the tab
    only when no tab is connected and not under `CI` or `SSH_CONNECTION`
    (no hook input tells a `-p` run apart, fact 23).
  - Tests: token and `Host` refused, SSE delivers an appended event, version
    mismatch, idle stop.
- [x] **1h · The UI.** `ui/` (React, `@xyflow/react`), built by esbuild to
  `ui/dist/watch.js` and committed; `npm run build:ui`.
  - The graph from the reducer; the active node's feed; "detail" folded; the
    session state in plain words at the top; `en`/`es` from config.
  - A test builds the bundle in a temporary directory and fails when it
    differs from the committed one, so CI catches a stale bundle.
  - Checked in a real browser with a screenshot of a live session.
- [x] **1i · CLI.** `lib/cli/watch.mjs`: `docrank watch` starts the server if
  needed and prints (and opens) the URL.
- [x] **1j · Documents.** `docs/config.md` (1c); README: what watch shows,
  how to switch it on, how to get a task list on newer models, what is
  stored and where; `CLAUDE.md`: the bundle, its
  build, the dev dependencies and that the Node side still has none.
- [x] **1k · Version 0.3.0.** `package.json`, `package-lock.json`,
  `.claude-plugin/plugin.json`; `claude plugin validate .`.
- [x] **1l · PR** «feat(watch): a live plain-language view of the session».
  CI green on the four combinations.
- [x] **1m · Release and live trial (user).** Tag and release 0.3.0; one
  session with an observer reading the tab: tasks, a helper, a gate run, a
  guard refusal, a permission wait. Recorded in harness-facts § 15 and the
  README «What is proved live».
  Done: `docrank--v0.3.0` released on `8dd9971`; the trial run by the
  orchestrator, its fixes landing as 0.3.1.

### [ ] 2 · History and timeline — branch `feat/watch-history`

- [x] **2a · Retention.** The server deletes session files older than
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
