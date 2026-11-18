# Docs as spec

What holds a repository's documents and its code to each other: two checks a
command runs, a library a test reads documents with, and two judges. Every key
named here is documented in [config.md](config.md).

## The checks

Each prints one line per failure and exits 1, or prints one line and exits 0.
A check whose key is empty prints that it is off and exits 0.

- `node lib/check-sections.mjs` — every section reference — a document's name, then `§` and a heading — under
  `docs.scanRoots` names a heading, or a bold lead-in, of the document it
  cites. A reference is a link, a backticked path or a bare `x.md`, then `§`;
  `§§ A, B and C` holds each item. A reference to a document under
  `docs.historyRoots`, or to a name one of them holds, passes: history cites
  the tree as it was.
- `node lib/check-drift-pairs.mjs` — every directory and source file directly
  under a root of `docs.unitRoots` is started by a code prefix of
  `docDrift.entries`, or by a key of `docDrift.unpaired`. It also refuses an
  entry path the tree does not hold and an exception that excuses nothing.

Both export their function (`checkSections(config)`,
`checkDriftPairs(config)`), which takes what `loadConfig()` returns and gives
back the failure lines.

## Reading a document in a test

`lib/doc-facts.mjs` reads what a document states, so a test compares it with
the value the code holds instead of a copy of either. Each reader throws when
what it was asked for is not there, so a renamed heading fails the test that
read it instead of comparing an empty list.

| Reader | Returns |
|---|---|
| `readDoc(path, root?)` | the text of a document, by its path from the repository root |
| `section(text, heading)` | the passage under a heading, to the next heading of its level or above |
| `listItems(text)` | the top-level items of the first list, wrapped lines folded |
| `table(text, header)` | `{header, rows}` of the first table with that column, cells raw |
| `column(text, header)` | the cells under a header, a cell that is one code span as its content |
| `cell(text, header, key)` | the cell under a header in the row whose first cell is `key` |
| `codeSpans(text)` | the contents of every code span, in order |
| `paragraphWith(text, needle)` | the paragraph that says `needle`, on one line |
| `numberOf(token)` | a number as English prose writes it: `6,000`, `seven`, `forty-eight` |
| `plain(cell)` | a cell that is one code span as its content, any other as written |

The plugin's own tests read [config.md](config.md) this way
(`lib/doc-facts.test.mjs`); a repository imports the module from where the
plugin is installed:

```js
import { column, readDoc, section } from "./lib/doc-facts.mjs";

const keys = column(section(readDoc("docs/config.md"), "`docs`"), "Key");
expect(keys).toContain("docs.precedence");
```

## The judges

`docrank:spec-arbiter` and `docrank:surface-reviewer` preload the
`judge-protocol` skill and hold no tool that edits, so the read-only guard
keeps their Bash to reads. Agent frontmatter cannot read the repository's
config, and a brief can be paraphrased or forgotten on a re-check, so each
judge Reads `.claude/docrank.json` itself before anything else, and takes a
key it does not set from this repository's `docs/config.md`. Read is not
Bash, so the read-only guard never stands between a judge and its config.

The surface reviewer's browser is the plugin's MCP server `browser`
(`.mcp.json`, `chrome-devtools-mcp` pinned, headless, a throwaway profile):
a plugin agent's `mcpServers` frontmatter is ignored
([harness-facts.md](harness-facts.md) § 6). Its tools are named
`mcp__plugin_docrank_browser__<tool>`, and the reviewer's `tools:` names only
those that read a page.
