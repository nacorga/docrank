---
name: demo
description: Build a throwaway repository in which the spec arbiter finds a change that passes its test and breaks its written spec, and print how to open a session there and the three steps to type. Run by hand.
argument-hint: "[<dir>] — default: a new temporary directory; one that exists is refused"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/demo.mjs *) Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/demo.mjs)
---

Build the demo and hand its instructions over.

1. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/demo.mjs $ARGUMENTS`. It builds a
   bare remote, a main checkout on `main` and a worktree on `demo/tracking`
   from the plugin's `examples/consent`, and prints the paths, the command
   that opens a session in the worktree, the three steps to type there and,
   apart from them, what each should show.
   A directory that exists is refused untouched: report the script's message
   and stop.
2. Reply with the script's output verbatim, in a code block, and nothing
   else.

Do not open the session, run the gates or launch a judge from here: this
session's working directory is another repository, and the demo's
configuration is read from the worktree's. Do not run anything else.
