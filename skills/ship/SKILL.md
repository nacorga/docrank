---
name: ship
description: Carry one piece of work from the ask to a green pull request — its own worktree cut from the integration branch, a plan, the gates and the jobs its diff can break, the judges, the pull request watched until CI is green — and, once it merges, clean up. Invoking it is the user's approval for the branch, the push and the pull request; never for the merge.
argument-hint: "<what to do>"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/docrank.mjs *) Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/watch-pr.mjs *) Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/prune-worktrees.mjs *)
---

The work: $ARGUMENTS

Invoking `/ship` approves, for this work only: creating its branch and
worktree, committing, pushing that branch, and opening its pull request
against the integration branch. Do not ask for them again. It approves nothing
else: the merge is the user's, and so is anything with an effect outside the
repository.

Every setting below is in `.claude/docrank.json`; `docs/config.md` of the
plugin lists each key with its default. Read the file once before stage 1.

## In order

1. **Worktree.** Unless this session already runs in a worktree cut from the
   integration branch (`branches.integration`), make one with `EnterWorktree`
   and the name `<type>/<slug>`, `<type>` being the conventional-commit type
   the work will carry. The `WorktreeCreate` hook cuts the branch from a
   fetched `origin/<integration>` in `../<repo>-<slug>`, copies
   `worktree.copy` and runs `worktree.install`. If the harness did not run it
   (`--worktree --tmux`, or Claude Code older than v2.1.300), run
   `node "${CLAUDE_PLUGIN_ROOT}/bin/docrank.mjs" worktree <name>`: it makes
   the same worktree, and prints its path. A bare `git worktree add` skips
   the copy and the install. From then on every edit and command is the
   worktree's; the main checkout belongs to other sessions.
2. **Plan.** Write it in `ship.plansDir`, named by today's date and the slug:
   what was asked, then checkable items, each naming the evidence that will
   close it. When `plan.requiredHeadings` is set, the plan also carries a
   section headed by one of them (a Markdown heading of any level, the text
   case-insensitive and followed by anything but a letter, digit or
   underscore), or the plan guard refuses `ExitPlanMode`. The scope is the
   whole ask; leaving part out is a recommendation to the user with its
   reason, never a silent cut. Show the plan and go on, unless it holds a
   decision that is the user's (scope, product, anything outside the
   repository), and then ask that one question. Tick items as they close: the
   plan is what survives a compaction.
3. **Build.** Every subagent that can edit carries the block of the
   `dispatch-guardrails` skill, and its report answers the block's hand-over
   checks, each with its search and count; a report without them goes back
   before any judge reads the work. A slice the plan marks heavy is
   dispatched with `model: "opus"` and a line of its own `Heavy: <path>`
   naming that plan, whose text says "heavy"; with `dispatch.heavyMarker` on,
   the dispatch guard refuses a `general-purpose` Opus dispatch without it,
   and one that names no model runs on `dispatch.defaultModel`.
4. **Verify.** The gates (the `gates` skill, `-C <worktree>`), then the jobs
   `ship.pathJobs` maps to the paths the diff touches: for each entry whose
   `paths` a changed file starts with, run its `jobs` by name through the same
   skill; no entry matches, no job. Then the judges:
   `node "${CLAUDE_PLUGIN_ROOT}/bin/docrank.mjs" judges` in the worktree names
   which the diff launches, from `judges.routes`, and prints how a round runs;
   with a fix's range (`judges <judged>..HEAD`) it names which judges the
   fix's re-check owes.
5. **Pull request.** `git fetch origin <integration>`, rebase on it, and if the
   rebase brought anything, stage 4 again. Gates on that head (they record it
   for the push check), push the branch and
   `gh pr create --base <integration>`. The handover guard may refuse it with
   the repository's checklist (`pr.checklist`). With `pr.requiredLines` set, a
   body that carries a line for each entry the diff owes passes at the first attempt and
   one that lacks an entry owed is refused every time, naming it: write the line,
   then run the command again. Without it, answering the checklist and
   running the same command again passes.
6. **CI.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/watch-pr.mjs" <n>` in the
   background: it prints `GREEN`, `NO CI`, `RED` with the failed checks,
   `CONFLICTING`, `MERGED` or `CLOSED`, and its exit wakes the session. Red:
   read the failed log, fix on this branch, stages 4 to 6 again.
   `CONFLICTING`: GitHub runs no check on a conflicting pull request, so none
   will register; rebase on `origin/<integration>`, stage 4 again,
   `git push --force-with-lease`, and watch again. `MERGED` or `CLOSED`: the
   user acted meanwhile; go on to stage 8 for the first, stop with what it
   showed for the second. The pull request is handed over green.
7. **Report**, in `principles.reportLanguage`: the link, what changed in a few
   lines, the evidence and every finding the judges left open. When
   `principles.closingLine` is set, end with that line naming exactly what the
   user does next, or saying nothing is pending on their side. Then
   `watch-pr.mjs <n> merged` in the background, so the user never has to say
   it merged or that it conflicts.
8. **After the merge**, when that watcher prints `MERGED`: check that
   `origin/<integration>` holds the commit; only then leave the worktree
   (`ExitWorktree`, keep), `git worktree remove` it and delete the branch (the
   Bash guard allows it only because the pull request merged with that tip).
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/prune-worktrees.mjs"` lists other
   worktrees whose pull request merged the same way; `--apply` removes them.
   `CONFLICTING`: another merge landed first. Rebase on
   `origin/<integration>`, stage 4 again, `git push --force-with-lease`, stages
   6 and 7 again. `RED` with the failed checks: one failed while the pull
   request waited for its merge; read the failed log, fix on this branch,
   stages 4 to 7 again. `ORPHANED`: a commit reached the branch after the
   merge; it is in no release, so open a pull request for it before deleting
   anything.
   `CLOSED`, or the commit missing, stops here with what it showed.
