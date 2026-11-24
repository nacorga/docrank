---
name: doc-lint
description: Read the repository's documentation, group by group (`docs.groups` in `.claude/stickler.json`), for what no test catches — two governing passages that state incompatible facts, a claim the tree shows is no longer true, a fact restated away from its owner — confirm each against the tree, fix what is confirmed, and carry it to a pull request against the integration branch. Use when a documentation sweep is wanted, by hand or from a scheduled routine.
argument-hint: "[group ...] — default: every group in docs.groups"
---

The groups: $ARGUMENTS

The mechanical checks hold what can be read by a machine: every
reference to a section (a document's name, then `§`) names a heading
(`node "${CLAUDE_PLUGIN_ROOT}/lib/check-sections.mjs"`), and every code unit
has a document that states it
(`node "${CLAUDE_PLUGIN_ROOT}/lib/check-drift-pairs.mjs"`). What they cannot
read is prose against prose. Most of what this finds is a passage left behind
when a change moved a fact and updated only its owner; the spec arbiter
catches that on the diff that causes it, and this is the backstop.

## In order

1. **Configuration.** Read `.claude/stickler.json` and, for a key it does not
   set, the default `${CLAUDE_PLUGIN_ROOT}/docs/config.md` states. You need
   `docs.groups`, `docs.precedence`, `docs.historyRoots`, `docs.registry` and
   `branches.integration`. With no group configured, or none of the groups
   asked for, say so and stop. Run the two checks above first; their failures
   go into the fix like any finding.
2. **Worktree.** Unless the session already works on a branch cut from
   `<integration>` for this sweep, cut one, `docs/doc-lint-<YYYY-MM>`, from
   the fetched `origin/<integration>`, in its own worktree. Never commit to
   the branch that was checked out.
3. **Read.** One read-only `Explore` agent per group, all in one message.
   Each reads its group's documents in full, by section, beside the ladder of
   `docs.precedence`, and skips `docs.historyRoots`. Each reports findings
   only, under three labels: a **contradiction** between two passages, a
   **stale** claim the tree shows false (checked against the code, the
   manifests, `git log`), or a fact **restated** away from its owner and
   drifted. Each finding comes with both quotes, their `file:line`, the
   winning side by rank, and the exact replacement text. Precision over
   recall: a false finding costs more than a missed one. Each agent skips
   what `docs.registry` already holds.
4. **Confirm.** Before a finding becomes an edit, read both quotes in the
   tree yourself. An agent's word is not evidence. A finding whose two sides
   do not say what it claims is dropped.
5. **Fix.** Fix the losing side of each confirmed finding, then grep the
   tree for every other passage stating the same fact. A count or list the
   code can enumerate gets its registry entry in the same change. Leave two
   kinds of finding alone and list them in the pull request instead:
   - **Words a customer reads**: copy shipped to users, in any language. The
     user judges copy.
   - **Facts only the user knows**: whether something outside the tree
     happened.
6. **Verify.** Commit the fixes in one conventional commit whose body lists
   each fix by document and its evidence, then run the `gates` skill, then
   the `stickler:spec-arbiter` agent over the branch. A fix of its findings is
   a new commit, passes the gates and gets a re-check of its range, as the
   `judge-protocol` skill sets out.
7. **Pull request.** Push the branch and open the pull request against
   `<integration>`; its body ends with what was left for the user. Nothing
   confirmed means nothing pushed and no pull request, only the report. The
   merge is the user's.
