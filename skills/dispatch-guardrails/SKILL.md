---
name: dispatch-guardrails
description: The standing constraint block for a dispatched implementer or reviewer — what an agent may not reach for when it hits a wall, what it checks before it hands over, and the reporting contract. Use whenever composing a subagent dispatch, and copy the block rather than paraphrasing it.
---

A subagent that hits a wall does not stop. It reaches — for shared
configuration, for `--amend`, for a cheaper command that resembles the gate.
Each reach is locally reasonable and globally wrong, because the agent cannot
see what it is reaching into. Each constraint below answers one of those
reaches.

Copy the block into the dispatch verbatim: a paraphrase drops the clause that
mattered. docrank's dispatch guard appends every line a dispatch to an agent
that can edit lacks, so a dispatch that forgets it still carries it. A
repository adds its own lines in the file `dispatch.guardrailsFile` names in
`.claude/docrank.json`; the guard appends that file after this block, and a
dispatch copies both.

## The block

```text
## Hard constraints

- **Read the repository's memory index first, when it tracks one**, and every
  memory it lists that touches your task. The session's memory does not reach a
  subagent, and those are the user's standing rules.
- **Never touch a remote.** No push, fetch, pull, or pull request. Commit
  locally only. If you believe a remote operation is needed, stop and say so
  in your report: publishing is the user's decision.
- **Never rewrite shared history.** No `git commit --amend`, no rebase, no
  force. A correction is a new commit, so a reviewer's re-check has the range
  of what changed since it last read.
  Folding a point's commits into one is the session's, once its review has
  closed.
- **Never modify shared configuration to get past a problem.** A config that
  serves the whole repository is not yours to bend for one change. A wall is a
  finding: report BLOCKED with what you tried.
- **Verify what you changed; the whole suites are the session's.** For your
  change and each fix round: the gates, and the specs that name what you
  changed, found by searching the whole tree for each string, identifier and
  component your diff changes, not by the files you touched. The whole
  browser or end-to-end suite is the session's, when the work converges; you
  run it only when the brief hands you a red from CI to prove, and any other
  brief asking for it yields to this line.
- **Run the gate, not a proxy for it.** The check the repository runs is the
  one that counts; a narrower command over the files you touched is a
  different check and will not catch what the gate catches.
- **Never hand-edit a generated file.** Change its source and run its
  generator, or leave it alone and say so.
- **In a worktree, `git` runs plain.** Claude Code refuses a command it
  cannot prove stays there, such as a long heredoc carrying a script or a
  file, or `git` in a command that also holds a `$(…)`, a loop, a
  multi-line inline script or a path out of the worktree: edit files with
  Edit or Write, write a script or a commit message to a file and run it or
  pass it, and run `git` as a call of its own — no `cd … &&` before it, no
  `git -C`, no `source`.
- **Open a file with Read before you edit it.** A `cat` or a `sed` read does
  not count: Edit refuses a file Read has not opened.
- **Escalate rather than route around.** "This is too hard for me" is a
  complete report: bad work is worse than no work.

## Before you hand over

For an agent that edits: each check that your change calls for is done before
you report, and the report gives each one's search and its count. A read-only
reviewer reports each instance it finds as a finding instead of fixing it.

- **Every passage your change leaves stale.** For each sentence, rule, name
  or value you changed, search the whole tree — documents, configuration,
  scripts and code comments — and replace each stale passage, never adding
  the new rule beside the old one.
- **Every twin of what you fixed.** For each defect fixed, search every other
  place that draws, states or computes the same thing, and fix each instance.
- **Every rule says where it holds.** A rule you write names the case it is
  for. Search before you write "every", "never", "only" or "the one".
- **Every new value pinned.** A threshold, limit or name the code introduces
  is stated in the document that governs it, in the same commit.
- **Every existing assertion you changed** is listed with its before and
  after, and why the new one is right.
- **Every wait ends by itself.** Anything you wait on in the background has a
  deadline; past it, check the process and report what you saw.

## Reporting

Your final message is your report, in full — or, when you hand back with
`SubagentHandback` or were reached through `SendMessage`, the message you
send: outcome, commits, each command you ran with its result, the checks
above with their counts, and concerns. Write no report file.
```

A reviewer gets the same block with one line added under `## Hard
constraints`, verbatim too:

```text
- **You are read-only.** Never change the working tree, the index, HEAD or a
  branch.
```

docrank's read-only guard holds an agent whose type cannot edit to Bash reads
alone, so for a read-only reviewer that line is enforced, not only asked.

## Dispatching on Opus

With `dispatch.heavyMarker` on (the default), the dispatch guard refuses a
`general-purpose` dispatch, named or by default, whose `model` contains
`opus` unless its prompt holds a line of its own, `Heavy: <path>`. The path,
read from the repository root or absolute, must name a file that can be read
and whose text contains the word "heavy", in any case, anywhere: the plan
that marks the slice. A dispatch that names no model needs no line: it runs
on `dispatch.defaultModel`. Any other agent type, an `Explore` too, is not
checked for it.

## When the report does not arrive

A subagent's final message is not guaranteed to arrive. Claude Code keeps
every subagent's transcript, so the report is on disk even when the message
is lost: `node "${CLAUDE_PLUGIN_ROOT}/scripts/last-report.mjs" <transcript>`
prints the last thing the agent said, as text or handed back. The transcript
is the output file the dispatch names, or `subagents/agent-<id>.jsonl` beside
the session's own transcript. Read it before dispatching again: the work is
usually done.

## What this is not

Not a substitute for reviewing the diff. These constraints stop an agent
wandering; they say nothing about whether what it built is right.
