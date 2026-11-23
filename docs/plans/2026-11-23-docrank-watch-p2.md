# docrank watch, second round — the plan

## Context

After the live trials of 0.4.x and the chips (PR #26), the user approved three
changes on 2026-11-23, to ship together in one release (0.5.0):

1. **Tasks without friction.** The task layer appears only when the session
   starts with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (harness fact 22). `init`
   offers, when it turns watch on, to write that variable in the `env` of the
   repository's `.claude/settings.json`. And a session with no task list groups
   its actions by turn ("Turn 1", "Turn 2"…) instead of one "work without a
   list" node. The prompt's text is still not stored.
2. **The outcome, not only the action.** A gate run, a command or a test that
   failed shows it: the chip and the feed entry say passed or failed
   (`run-gates ✓` / `✗`), from what the hook already sees (`PostToolUse` vs
   `PostToolUseFailure`, a Bash exit code if the response carries one). No
   tool output is stored beyond that verdict.
3. **A closing summary.** When the session is done (or waits for an answer at
   the end of a turn), a closing card: tasks done, subagents used, guard
   refusals, failures, duration. It is also what a past session opens on.

## How the work runs

- One branch `feat/watch-p2` and worktree `../docrank-watch-p2`, cut from
  `origin/main` at `995e029`; one PR at the end. Merge and release: the merge
  is the user's; the release (0.5.0) was approved with this plan.
- Each slice is built by a fresh subagent, briefed from this plan and
  `CLAUDE.md`, in order, as commits on the same branch.
- Conventional commits with a scope and the session's `Co-Authored-By` line.
- A slice closes with tests green and a screenshot from a replayed trial log.

## Slices

- [x] **1a · The plan enters the tree.**
- [ ] **1b · `env` in settings: harness fact.** Verify in the settings docs
  that `.claude/settings.json` `env` applies to the session at start, so that
  `CLAUDE_CODE_ENABLE_TODO_TOOLS` set there enables the task tools; record it
  in `docs/harness-facts.md` (VERIFIED with quote, or NOT DOCUMENTED). If NOT
  DOCUMENTED, `init` still offers it but says it is unproved.
- [ ] **1c · `init` offers the variable** when it proposes `watch.enabled`,
  writing nothing without confirmation, merging into an existing
  `.claude/settings.json`; README says so.
- [ ] **1d · Turns when there is no list.** The reducer groups actions by
  `UserPromptSubmit` into turn nodes when the session has no task; a task list
  that appears later takes over as today. Background-agent notifications that
  arrive as `UserPromptSubmit` (fact 23 area) do not open a new turn when a
  subagent result just arrived — or, if they cannot be told apart, the code
  says so. Tests on the trial fixtures and a synthetic no-task log.
- [ ] **2a · Verdicts.** The hook records `ok: false` on `PostToolUseFailure`
  and, for Bash, the exit code when the response carries it (checked against
  [hooks]; recorded as a fact if new). Phrases and chips carry ✓/✗; the gate
  chip says whether the gates passed. Tests.
- [ ] **3a · Closing card.** From the reducer: tasks done/total, subagents by
  type, refusals, failures, duration; shown at the end of a session and when a
  past session opens; en/es. Tests and a screenshot.
- [ ] **4a · Documents and version 0.5.0**, README, `CLAUDE.md` if the shape
  changed; PR, CI green.
- [ ] **4b · Release 0.5.0** after the merge; this plan leaves the tree in the
  same PR as 4a (checked before deletion).

[hooks]: https://code.claude.com/docs/en/hooks.md
