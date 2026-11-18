#!/usr/bin/env node
/**
 * PreToolUse hook on Bash: an agent of a read-only type (lib/agent-types.mjs)
 * runs reads and nothing else. Such an agent holds Bash to reach `git diff`
 * and `grep`, and without this hook only its prompt keeps that Bash from
 * writing; the dispatch guard exempts these types from the guardrails block
 * on the strength of it being true.
 *
 * Claude Code names the agent a hook fires in with `agent_type`; a call
 * without one is the main session's, and this hook stays out of the way. The
 * command is split on its operators, outside quotes, and every segment must
 * be a read the list below allows: an allow-list, because a read-only agent
 * that hits a wall reaches for whatever runs, and a deny-list misses the
 * reach nobody foresaw. A `$(…)` is a command line of its own and is judged
 * the same way; a backtick is refused, since nesting hides where it ends.
 * What an expansion yields is not known until it runs, so a word it fills
 * reaches only a command with no option that writes or runs.
 */
import { isReadOnlyType } from "../lib/agent-types.mjs";
import { configFor, deny, readInput } from "../lib/hook.mjs";


const reads = new Set([
  "basename", "cat", "cd", "column", "comm", "cut", "date", "diff",
  "dirname", "du", "echo", "file", "find", "gh", "git", "grep", "head", "jq",
  "ls", "nl", "printf", "pwd", "realpath", "rg", "sed", "sort", "stat", "tail",
  "test", "tr", "true", "uniq", "wc", "which", "[", "curl", "awk",
]);
/**
 * The reads with no option that writes or runs, so a word an expansion
 * fills, `$name` or `$(…)`, cannot make them do either.
 */
const expandable = new Set([
  "basename", "cat", "cd", "column", "comm", "cut", "diff", "dirname", "du",
  "echo", "grep", "head", "jq", "ls", "nl", "printf", "pwd", "realpath",
  "stat", "tail", "test", "tr", "true", "wc", "which", "[",
]);
/** The mark an expansion leaves in a word: never a command's name. */
const EXPANDED = "⟨$⟩";
const gitReads = new Set([
  "blame", "branch", "cat-file", "describe", "diff", "for-each-ref", "grep",
  "log", "ls-files", "ls-tree", "merge-base", "name-rev", "range-diff",
  "rev-list", "rev-parse", "shortlog", "show", "status", "worktree",
]);
const ghReads = { pr: ["view", "list", "diff", "checks", "status"], run: ["view", "list"] };
/**
 * A `sed` script that prints lines and does nothing else: `5p`, `1,40p`,
 * `$p`, and an address by pattern, `/re/p` or `/a/,/b/p`.
 */
const sedAddress = String.raw`(?:\d+|\$|/(?:[^/\\]|\\.)*/)`;
const sedPrint = new RegExp(`^${sedAddress}(?:,${sedAddress})?p$`, "u");
/** A `curl -w` format of plain `%{variable}`s: `%output{}` writes a file. */
const curlFormat = /^(?:[^%]|%\{(?!std(?:out|err)\})\w+\})*$/u;
/** The `curl` flags a read needs: alone, or (`takesValue`) with the next word. */
const curlFlags = new Set([
  "-s", "--silent", "-S", "--show-error", "-L", "--location", "-I", "--head",
  "-i", "--include", "-f", "--fail", "-k", "--insecure", "-v", "--verbose",
  "--compressed",
]);
const curlTakesValue = new Set(["-H", "--header", "-m", "--max-time", "-A", "--user-agent"]);

const input = await readInput();
const type = input.agent_type;
if (!type) process.exit(0);
if (!isReadOnlyType(type, configFor(input).root)) process.exit(0);

const refusal = judge(input.tool_input?.command ?? "");
if (refusal) {
  deny(
    `${type} is a read-only agent type (docrank, lib/agent-types.mjs): ${refusal} It may run git ${[...gitReads].join("/")}, ${[...reads].filter((r) => r !== "git").join(", ")} — with no redirect into a file, a \`$(…)\` only around reads and never a backtick, a \`$name\` or \`$(…)\` only as a word of ${[...expandable].join(", ")}, gh and curl only to read (curl's -o only to /dev/null), and awk only with -F and -v and a one-line program that runs nothing, calls no getline and writes nothing. A \`for … in …; do <reads>; done\` and a lone \`name=value\` are allowed. What needs more is the caller's to run: say so in your report.`,
  );
}

/** Why `command` is not a read, or `null` when every segment is one. */
function judge(text) {
  const segments = [];
  let words = [];
  let word = "";
  let quote = null;
  let quoted = false;
  const endWord = () => {
    if (word || quoted) words.push(word);
    word = "";
    quoted = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (quote === "'") {
      if (c === "'") quote = null;
      else word += c;
      continue;
    }
    if (c === "`") return "it substitutes a command (a backtick).";
    // A `$(…)` runs what it holds, so that is judged as a command line of its
    // own. What any expansion yields is unknown here and may be an option, so
    // the word keeps a mark that only `expandable` commands accept.
    if (c === "$" && next === "(") {
      const end = closing(text, i + 2);
      if (end < 0) return "its `$(` does not close.";
      const inner = text.slice(i + 2, end);
      if (text[i + 2] === "(") {
        // A name in arithmetic is evaluated, and its value can run a command.
        if (!/^\([\d\s+\-*/%<>=!&|^~?:,()]*\)$/u.test(inner)) {
          return "its `$((` holds more than digits and operators.";
        }
      } else {
        const why = judge(inner);
        if (why) return `its \`$(${inner})\`: ${why}`;
      }
      word += EXPANDED;
      i = end;
      continue;
    }
    // `$'…'` decodes escapes, so `$'\055o'` is a `-o` no check would see.
    if (c === "$" && (next === "'" || next === '"')) {
      return "it quotes with `$'` or `$\"`.";
    }
    if (c === "$" && /[\w{@*#?$!-]/u.test(next ?? "")) {
      if (next === "{") {
        // `${x:-$(…)}` would run what it holds: a name alone, or its length.
        const body = /^\{(#?[\w@*?$!-]+)\}/u.exec(text.slice(i + 1));
        if (!body) return "its `${…}` holds more than a name.";
        i += body[0].length;
      } else i += /^\w+/u.exec(text.slice(i + 1))?.[0].length ?? 1;
      // zsh reads `$x[…]` as a subscript, evaluated as arithmetic.
      if (text[i + 1] === "[") return "it subscripts an expansion (`$x[…]`).";
      word += EXPANDED;
      continue;
    }
    // Any other `$` before a character starts a form this parser does not
    // read — `$[…]`, zsh's `$~x`, `$=x` — so it is refused, not taken as text.
    if (c === "$" && next !== undefined && !/\s/u.test(next) && !(quote === '"' && next === '"')) {
      return `its \`$${next}\` starts an expansion the guard cannot read.`;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "\\" && next !== undefined) word += text[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      quoted = true;
      continue;
    }
    if (c === "\\" && next !== undefined) {
      word += text[++i];
      continue;
    }
    // Unquoted, each expands or runs: a brace list into words that may be
    // options, a glob qualifier or zsh's `=(…)` into a command.
    if (c === "(" || c === "{" || c === "}") {
      return `it holds an unquoted \`${c}\`: quote it.`;
    }
    if (c === "<" && next === ">") return "it opens a file to write (`<>`).";
    if (c === ">" || (c === "&" && next === ">")) {
      // The descriptor written before the operator, as in 2>.
      if (/^\d$/u.test(word)) word = "";
      let j = c === "&" ? i + 2 : i + 1;
      if (text[j] === ">") j += 1;
      if (text[j] === "&" && /\d/u.test(text[j + 1] ?? "")) {
        i = j + 1;
        continue;
      }
      while (text[j] === " ") j += 1;
      const target = /^[^\s;|&]+/u.exec(text.slice(j))?.[0] ?? "";
      if (target !== "/dev/null") {
        return `it redirects output into \`${target || "?"}\`.`;
      }
      endWord();
      i = j + target.length - 1;
      continue;
    }
    if (c === "|" || c === ";" || c === "&" || c === "\n") {
      endSegment();
      if ((c === "|" || c === "&") && next === c) i += 1;
      continue;
    }
    if (c === " " || c === "\t") {
      endWord();
      continue;
    }
    word += c;
  }
  if (quote) return "its quotes do not close.";
  endSegment();

  for (const segment of segments) {
    const why = readOnly(segment);
    if (why) return `\`${segment.join(" ")}\` ${why}`;
  }
  return null;
}

/**
 * The index of the `)` that closes a `$(` whose body starts at `start`, past
 * nested parentheses and quotes, or -1.
 */
function closing(text, start) {
  let depth = 1;
  let quote = null;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === "\\") i += 1;
    else if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "$" && text[i + 1] === "(") {
        const end = closing(text, i + 2);
        if (end < 0) return -1;
        i = end;
      }
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "(") depth += 1;
    else if (c === ")" && (depth -= 1) === 0) return i;
  }
  return -1;
}

/** Why one segment, split into words, is not a read, or `null`. */
function readOnly([name, ...args]) {
  // A lone assignment sets a shell variable; one before a command sets its
  // environment, and an environment variable can name a program to run.
  if (/^\w+=/u.test(name)) {
    return args.length ? "sets a variable for the command it runs." : null;
  }
  // A loop runs nothing itself: `for x in …`, then each command its body holds.
  if (name === "for") {
    return /^\w+$/u.test(args[0] ?? "") && (args.length === 1 || args[1] === "in")
      ? null
      : "is a `for` that is not `for <name> in <words>`.";
  }
  if (name === "do") return args.length ? readOnly(args) : null;
  if (name === "done") return args.length ? "runs words after `done`." : null;
  if (!reads.has(name)) return `runs \`${name}\`, which is not a read.`;
  if (!expandable.has(name) && args.some((arg) => arg.includes(EXPANDED))) {
    return "takes a word a `$name` or `$(…)` fills, which may be an option that writes or runs.";
  }
  const has = (...flags) => hasOption(args, flags);

  switch (name) {
    case "git":
      return gitRead(args);
    case "find":
      return has("-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls")
        ? "acts on what it finds."
        : null;
    case "sed":
      return sedRead(args) ? null : "may write or run: only `sed -n '<a>,<b>p'` prints.";
    case "sort":
      return args.some((arg) => /^-[a-zA-Z]*o/u.test(arg)) || has("--output", "--compress-program")
        ? "writes its output to a file or runs a program."
        : null;
    case "uniq":
      return args.filter((arg) => !arg.startsWith("-")).length > 1
        ? "writes its output to a file."
        : null;
    case "rg":
      return has("--pre") ? "runs a preprocessor command." : null;
    case "gh": {
      const allowed = ghReads[args[0]];
      return allowed?.includes(args[1]) ? null : `\`gh ${args.slice(0, 2).join(" ")}\` is not a read.`;
    }
    case "curl":
      return curlRead(args) ? null : "may send data or write a file: only a GET it prints.";
    case "awk":
      return awkRead(args)
        ? null
        : "may write, pipe or run: only `-F` and `-v`, and a one-line program with no `system`, `getline` or `@`, nor a `>` or `|` after its first `print`.";
    case "file":
      return hasShort(args, "C") || has("--compile") ? "writes a compiled magic file." : null;
    default:
      return null;
  }
}

/**
 * Whether `args` carries one of `flags`. GNU getopt and git's option parser
 * take any unambiguous prefix of a long option, so `--out=x` is `--output=x`:
 * a long word matches every flag it begins.
 */
function hasOption(args, flags) {
  return args.some((arg) => {
    const word = arg.split("=")[0];
    return flags.some((flag) =>
      word.startsWith("--") && word.length > 2 ? flag.startsWith(word) : word === flag,
    );
  });
}

/**
 * Whether a short option in `letters` is among `args`. git and getopt take
 * short options clustered in one word, and a value attached to the last, so
 * `-dr` deletes and `-Osh` opens: any letter of a one-dash word counts, and
 * a value that happens to hold one is refused on the safe side.
 */
function hasShort(args, letters) {
  return args.some(
    (arg) => /^-[a-zA-Z]/u.test(arg) && [...letters].some((letter) => arg.slice(1).includes(letter)),
  );
}

/** `-n` and `-e`, and every script a print of a line range. */
function sedRead(args) {
  const scripts = [];
  let files = 0;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-n") continue;
    if (args[i] === "-e") scripts.push(args[(i += 1)] ?? "");
    else if (args[i].startsWith("-")) return false;
    else if (scripts.length === 0 && files === 0) scripts.push(args[i]);
    else files += 1;
  }
  return (
    scripts.length > 0 &&
    scripts.every((script) => script.split(";").every((part) => sedPrint.test(part.trim())))
  );
}

/**
 * `-F` and `-v` alone before the program, and a program that only prints to
 * standard output. Read as plain text, since a `"` in a regex or a comment
 * is no string to awk: it names no `system` nor `getline` (which runs a
 * command or opens what it names), loads nothing with `@`, spans no line,
 * and holds no `>` or `|` after its first `print` or `printf`, where one
 * would be a file or a command it writes to.
 */
function awkRead(args) {
  let i = 0;
  for (; i < args.length && args[i].startsWith("-"); i += 1) {
    if (args[i] === "--") {
      i += 1;
      break;
    }
    if (args[i] === "-F" || args[i] === "-v") i += 1;
    else if (!/^-[Fv]./u.test(args[i])) return false;
  }
  const program = args[i] ?? "";
  if (/system|getline|@|\n/u.test(program)) return false;
  const print = program.search(/\bprintf?\b/u);
  return print < 0 || !/[>|]/u.test(program.slice(print));
}

/** Every flag one a read needs, a short cluster only of those. */
function curlRead(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("-")) continue;
    if (curlTakesValue.has(arg)) i += 1;
    else if (arg === "-o" || arg === "--output") {
      if (args[(i += 1)] !== "/dev/null") return false;
    } else if (arg === "-w" || arg === "--write-out") {
      if (!curlFormat.test(args[(i += 1)] ?? "")) return false;
    }
    else if (curlFlags.has(arg)) continue;
    else if (/^-[a-zA-Z]{2,}$/u.test(arg)) {
      if (![...arg.slice(1)].every((letter) => curlFlags.has(`-${letter}`))) return false;
    } else return false;
  }
  return true;
}

function gitRead(args) {
  let i = 0;
  while (i < args.length) {
    if (args[i] === "--no-pager") i += 1;
    else if (args[i] === "-C") i += 2;
    else break;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub || sub.startsWith("-")) return "passes git an option before its command.";
  if (!gitReads.has(sub)) return `runs \`git ${sub}\`, which is not a read.`;
  if (hasOption(rest, ["--output"])) {
    return "writes its output to a file.";
  }
  if (sub === "grep" && (hasShort(rest, "O") || hasOption(rest, ["--open-files-in-pager"]))) {
    return "opens what it finds in a program.";
  }
  if (sub === "worktree" && rest[0] !== "list") return "changes a worktree.";
  if (sub === "branch") {
    const changing = ["--delete", "--move", "--copy", "--force", "--set-upstream-to", "--unset-upstream", "--edit-description", "--track", "--no-track"];
    if (hasShort(rest, "dDmMcCfut") || hasOption(rest, changing)) {
      return "changes a branch.";
    }
    const listing = ["--list", "--all", "--remotes", "--show-current", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at"];
    const lists = hasShort(rest, "lar") || hasOption(rest, listing);
    if (!lists && rest.some((arg) => !arg.startsWith("-"))) return "creates a branch.";
  }
  return null;
}
