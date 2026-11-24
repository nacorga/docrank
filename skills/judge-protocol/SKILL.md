---
name: judge-protocol
description: How a review by the repository's judges runs, on both sides. A judge preloads it (its `skills:` names it) and keeps § The judge; the session that launches judges keeps § The caller. Not invoked by hand.
user-invocable: false
---

One copy of the rules a review keeps, so a judge and the session that
launches it never read two versions of a round. An agent is a judge because
its definition preloads this skill (`judges.skill` in `.claude/stickler.json`
names it, `judge-protocol` by default).

## The judge

- **A first pass is the whole review**: raise now what a later pass would,
  because a re-check judges only what the fix changed.
- **A re-check** is given your previous report and the fix's range,
  `<judged>..HEAD`, where `<judged>` is that report's `Judged:` line. Say
  whether each previous finding is resolved, then judge that range alone.
  After a rebase you are given instead the output of
  `git range-diff <base> <judged> HEAD`: judge what it shows changed.
  Anything else you notice goes under `## Late`, one line each, never as a
  finding. Do not walk the rest again.
- **Bash runs reads only.** stickler's read-only guard refuses anything else
  to an agent that cannot edit; what needs more is the caller's to run, and
  your report says so.
- **Your report is your answer**, however you were started. Dispatched as a
  task, the final message you write **is** the return value. Dispatched with
  a name, as an addressable teammate, that final message goes nowhere on its
  own: deliver the same report with `SendMessage` to the agent that asked
  (the `from` of the message you received; `main` when there is none) before
  you finish. A judge that judged and went quiet reads exactly like a judge
  that approved.
- **Your report ends with `Judged: <sha>`**, the commit you read, so a
  re-check can be scoped.

## The caller

- **Which judges** a diff needs is what the repository's routing
  (`judges.routes`) names for the paths it touches; a fix's range gets the
  same question for its re-check. Each judge's file says what it needs
  running, and the caller starts it.
- **What a judge reads is committed.** The work is in a commit before the
  first pass, and each fix is a new commit on top, so a range can scope a
  re-check; nothing is amended away from under a report, and a rebase is
  answered with `range-diff`.
- **Dispatch without `name`**: the final message is the report. When it does
  not arrive, `node "${CLAUDE_PLUGIN_ROOT}/scripts/last-report.mjs" <transcript>`
  reads it back. stickler refuses a named dispatch of an agent without
  `SendMessage`, which could never answer.
- **A round** waits for every judge launched in it and sends their findings
  as one fix.
- **A fix** passes the gates, then gets a re-check from each judge that had
  findings and each judge whose ground the fix's range touches. A re-check
  resumes the same judge with `SendMessage`, by the ID its dispatch returned,
  never a new dispatch: a new dispatch starts a judge with no previous report
  and no count. It is given the judge's previous report and `<judged>..HEAD`,
  or after a rebase the `range-diff` output.
- **An _unproven_ finding** a judge's tools cannot settle is not re-run: the
  session settles it by its own measurement, or records it as a gap with what
  would settle it.
- **`Late` lines are no findings.** The session decides each before the
  commit body is written: fixed in the next fix, whose range a re-check then
  covers, or dropped with its reason in the commit body.
- **The configured limit of re-checks closes a judge's review**
  (`judges.maxRechecks`), a rebase's among them. A finding still open after
  the last, and anything that changes the judge's ground after it, is the
  session's: it fixes it and proves it by its own measurement, or drops it
  with its reason in the commit body. No further re-check is dispatched, and
  stickler's re-check guard refuses the message that would be one; the same
  message sent again goes through, for one that is no re-check.
