import { describe, expect, it } from "vitest";
import { agent, project, runHook } from "../lib/testing.mjs";

// The cases are TraceLog's guard-read-only suite, on neutral names.
const dir = project({
  ".claude/agents/reviewer.md": agent("name: reviewer\ntools: Read, Grep, Bash, SendMessage"),
  ".claude/agents/auditor.md": agent("name: auditor\ntools: Read, Bash"),
  ".claude/agents/builder.md": agent("name: builder\ntools: Read, Edit, Bash"),
});

async function decision(command, agentType) {
  const output = await runHook(
    "guard-read-only.mjs",
    { tool_name: "Bash", tool_input: { command }, ...(agentType === undefined ? {} : { agent_type: agentType }) },
    dir,
  );
  return output?.permissionDecision ?? null;
}

describe("guard-read-only.mjs", () => {
  it("lets a read-only agent read", async () => {
    for (const [type, command] of [
      ["reviewer", "git diff main...HEAD -- lib | head -50"],
      ["reviewer", "git log --oneline -5 2>&1"],
      ["reviewer", 'grep -rn "a > b" docs/ 2>/dev/null | wc -l'],
      ["reviewer", 'git branch --list "feat/*"'],
      ["reviewer", "curl -s http://localhost:3000/ | head"],
      ["auditor", "git -C ../other show HEAD:README.md | sed -n 1,40p"],
      ["Explore", 'find . -name "*.ts" -not -path "*/node_modules/*" | head'],
      ["Plan", "cd packages && ls"],
      ["reviewer", "sed -n '1,40p;$p' README.md"],
      [
        "reviewer",
        'curl -sSL -H "Accept: text/html" -m 5 http://localhost:3000/',
      ],
      [
        "reviewer",
        'curl -s -o /dev/null -w "%{http_code} %{time_total}\\n" http://localhost:3000/',
      ],
      ["reviewer", "sed -n '/^## Objective/,/^## Governing/p' doc.md"],
      ["reviewer", "sed -n '/ceiling/p' README.md"],
      ["Explore", "for f in docs/*.md; do wc -l $f; done"],
      ["Explore", "for f in a b\ndo\n  grep -c x $f\ndone"],
      ["reviewer", "base=main; echo $base ${#base}"],
      ["reviewer", "cat $(ls)"],
      ["reviewer", "n=$(grep -c x docs/a.md | cut -d: -f1); echo $n"],
      ["Explore", "for f in $(git diff --name-only); do wc -l $f; done"],
      ["reviewer", "grep -c x $(git ls-files docs)"],
      [
        "reviewer",
        "echo \"$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)\"",
      ],
      ["reviewer", "echo $((1 + 2))"],
      // The sweep's own: each a read, refused before awk was allowed.
      ["reviewer", "awk '{print}' file"],
      ["reviewer", "git show --stat HEAD | awk '{print $1, $3}'"],
      ["reviewer", "grep -n '^#' d.md | awk -F: '$1>1240 && $1<1600'"],
      [
        "reviewer",
        "awk '/^### The new error/,/^### [^T]/' d.md | head -80",
      ],
      ["reviewer", "awk 'NR>=1290 && NR<=1420' d.md | grep -n x"],
      ["auditor", "awk 'NR<=2872 && /^#/ {h=NR\": \"$0} END{print h}' d.md"],
      [
        "reviewer",
        "awk 'NR>2070 && /^#{2,3} /{print NR\": \"$0; exit}' d.md",
      ],
      ["reviewer", "cat f | awk '$4==\"cwd\"{print $9}'"],
      ["Explore", "awk -F'\\t' -v n=2 '{print $n}' f"],
    ]) {
      expect(await decision(command, type), `${type}: ${command}`).toBeNull();
    }
  }, 30_000);

  it("refuses a read-only agent anything that writes or runs", async () => {
    const types = ["reviewer", "auditor", "Explore"];
    const commands = [
      "npm run generate",
      "git branch probe",
      "git stash list",
      "git diff --output=x",
      "echo hi > out.txt",
      'sed -i "" s/a/b/ file',
      "cat `ls`",
      "echo $(rm x)",
      "$(echo rm) x",
      "cat $(sort -o out f)",
      'echo "$(git branch probe)"',
      "echo $((1 + $(rm x)))",
      // What an expansion yields may be an option that writes or runs.
      "find . $(echo -delete)",
      "git diff $(echo --output=x)",
      "sort $(echo -o) out f",
      "curl $(echo -d x) http://localhost",
      `awk "$(echo '{system(1)}')" f`,
      "x=--output=o; git diff $x",
      "base=main; git log --oneline $base..HEAD",
      "for f in --output=o; do git diff $f; done",
      "sort ${x} f",
      "echo ${x:-$(rm x)}",
      "sort $'\\055o' out f",
      "x='a[$(touch p)]'; echo $((x))",
      "file -C -m out",
      // Syntax the guard does not parse is refused, never read as text.
      "cat =(touch p)",
      "ls *(e:'touch p':)",
      "x='*(e:touch p:)'; ls $~x",
      "x='-o out'; sort $=x f",
      "x='a[$(touch p)]'; echo $[x]",
      "sort {-o,out} f",
      "find . {-delete,-print}",
      "git diff {--output=x,--stat}",
      "curl {-d,x} http://localhost",
      "echo '{system(1)}' | awk {-f,/dev/stdin} f",
      "cat <> new",
      "y='a[$(touch p)]'; x=abc; echo $x[y]",
      'echo "${x}[y]"',
      // A `"` in a regex is no string to awk, and a print list spans lines.
      `awk '/"/{system("touch p")}' f`,
      `awk '/"/{print | "sh"}' f`,
      `awk '{print $0,\n"" > "out"}' f`,
      `awk '{print "a;" > "out"}' f`,
      "echo $(ls",
      "awk '{system(\"rm x\")}' f",
      "awk '{print > \"out\"}' f",
      "awk '{print $1 > $2}' f",
      "awk '{print | \"sh\"}' f",
      "awk '{\"date\" | getline d}' f",
      'awk \'{print ";" > "out"}\' f',
      "awk '{print /;/ > \"out\"}' f",
      "awk -f p.awk f",
      "awk -i inplace '{print}' f",
      "awk '@load \"x\"' f",
      "find . -delete",
      "find . -exec rm {} ;",
      "FOO=1 git log",
      "curl -so x http://localhost",
      "gh pr merge 1",
      "node scripts/build.mjs",
      "sort -o out file",
      "sort --compress-program=sh file",
      "sort --compress=sh file",
      "sort --out=x file",
      "git diff --out=x",
      "git grep -Osh x",
      "git grep --open=sh x",
      "git branch -dr origin/x",
      "git branch -a --del x",
      "sed -n 1w out file",
      "sed s/a/b/w out file",
      "sed -n 1e file",
      "sed -f script file",
      "tree -o out",
      "curl -c jar http://localhost",
      "curl -D headers http://localhost",
      "curl --trace out http://localhost",
      "curl -w %{stderr} http://localhost",
      "curl -o out http://localhost",
      'curl -w "%output{x}" http://localhost',
      "sed -n '/a/w out' file",
      "for f in a; do rm $f; done",
      "for f in a; do echo $f > out; done",
      "PAGER=sh git log",
    ];
    // Each command once, the read-only types taking turns: one spawn apiece.
    const decided = await Promise.all(
      commands.map((command, index) =>
        decision(command, types[index % types.length]),
      ),
    );
    commands.forEach((command, index) => {
      expect(decided[index], command).toBe("deny");
    });
  }, 30_000);

  it("leaves alone a session and an agent that can edit", async () => {
    for (const type of [undefined, "general-purpose", "claude", "builder"]) {
      expect(
        await decision("npm run generate", type),
        String(type),
      ).toBeNull();
    }
  });

});
