import { describe, expect, it } from "vitest";
import { PLUGIN_ROOT } from "./agent-types.mjs";
import { loadConfig } from "./config.mjs";
import { cell, codeSpans, column, listItems, numberOf, paragraphWith, readDoc, section, table } from "./doc-facts.mjs";
import { project } from "./testing.mjs";

const doc = `# Title

## Limits

Intro with \`a\` and \`b\`.

- one item
  wrapped here
- two
  - nested

After the list.

| Name | Value |
|---|---|
| \`max\` | 10 |
| min | \`2\` |

### Sub

Inside.

## Next

Other.
`;

describe("doc-facts readers", () => {
  it("reads a section up to the next heading of its level, subsections included", () => {
    expect(section(doc, "Limits")).toMatch(/Inside\.\n$/u);
    expect(section(doc, "Limits")).not.toMatch(/Other/u);
    expect(section(doc, "Sub").trim()).toBe("Inside.");
    expect(() => section(doc, "Missing")).toThrow('no heading "Missing"');
  });

  it("reads a list's top-level items, wrapped lines folded", () => {
    expect(listItems(section(doc, "Limits"))).toEqual(["one item wrapped here", "two - nested"]);
    expect(() => listItems("no list here")).toThrow("no list");
  });

  it("reads a table, a column and a cell", () => {
    expect(table(doc, "Value")).toEqual({ header: ["Name", "Value"], rows: [["`max`", "10"], ["min", "`2`"]] });
    expect(column(doc, "Name")).toEqual(["max", "min"]);
    expect(cell(doc, "Value", "max")).toBe("10");
    expect(cell(doc, "Value", "min")).toBe("2");
    expect(() => column(doc, "Nope")).toThrow('no table with the column "Nope"');
    expect(() => cell(doc, "Value", "mid")).toThrow('no row "mid"');
  });

  it("reads code spans, a paragraph and a number", () => {
    expect(codeSpans(section(doc, "Limits")).slice(0, 2)).toEqual(["a", "b"]);
    expect(paragraphWith("a\nb c\n\nd", "b c")).toBe("a b c");
    expect(() => paragraphWith(doc, "absent")).toThrow();
    expect([numberOf("6,000"), numberOf("seven"), numberOf("forty-eight"), numberOf("a thousand"), numberOf("two hundred")]).toEqual([
      6000, 7, 48, 1000, 200,
    ]);
    expect(() => numberOf("many")).toThrow('not a number: "many"');
  });

  it("reads a document from a root", () => {
    expect(readDoc("x.md", project({ "x.md": "hi" }))).toBe("hi");
  });
});

const isGroup = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Every leaf key path of the loaded config: what docs/config.md must document. A top-level leaf is its own path. */
const keyPaths = (config, nested = false) =>
  Object.entries(config).flatMap(([group, keys]) =>
    isGroup(keys) && (!nested || Object.keys(keys).length > 0) ? keyPaths(keys, true).map((key) => `${group}.${key}`) : [group],
  );

describe("docs/config.md, read with the library", () => {
  it("documents each key the loader defines, and no other", () => {
    const dir = project();
    const { root, ...config } = loadConfig({ cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } });
    const text = readDoc("docs/config.md", PLUGIN_ROOT);
    const documented = Object.keys(config).flatMap((group) => column(section(text, `\`${group}\``), "Key"));
    expect(documented.sort()).toEqual(keyPaths(config).sort());
  });
});
