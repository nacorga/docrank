/**
 * `stickler judges [<range>]`: which judges a diff needs (`judges.routes`),
 * beside the caller's half of the judge-protocol skill. With no range, what
 * this branch changed since it forked from the integration branch, working tree
 * and untracked files included (the first pass); with one, that range alone
 * (the re-check after a fix).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PLUGIN_ROOT } from "../agent-types.mjs";
import { loadConfig } from "../config.mjs";
import { git, glob } from "../git.mjs";

/** The body of the `## <heading>` section of a markdown text, or null. */
const section = (text, heading) => {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `## ${heading}`);
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
};

/** Every route, with the changed files on its ground: none means skip it. */
export const routesFor = (routes, files) =>
  routes.map(({ agent, ground }) => {
    const globs = ground.map(glob);
    return { agent, ground, files: files.filter((f) => globs.some((g) => g.test(f))) };
  });

export default function judges([range]) {
  const config = loadConfig();
  const { root, branches, judges: { routes, skill } } = config;
  const read = (...args) => {
    const out = git(root, ...args);
    if (out === null) throw new Error(`\`git ${args.join(" ")}\` failed: is \`${range ?? "the integration branch"}\` a ref here?`);
    return out;
  };

  let label;
  let files;
  if (range) {
    label = `\`${range}\``;
    files = read("diff", "--name-only", range);
  } else {
    const ref = [`origin/${branches.integration}`, branches.integration].find((r) => git(root, "rev-parse", "-q", "--verify", `${r}^{commit}`));
    if (!ref) throw new Error(`no integration branch to compare against: neither origin/${branches.integration} nor ${branches.integration} is a ref here`);
    const base = read("merge-base", "HEAD", ref);
    label = `this branch since \`${base.slice(0, 12)}\`, where it forked from \`${ref}\`, working tree included`;
    files = `${read("diff", "--name-only", base)}\n${read("ls-files", "--others", "--exclude-standard")}`;
  }
  const changed = [...new Set(files.split("\n").filter(Boolean))];

  const out = [`# The judges for ${label}`, ""];
  if (routes.length === 0) out.push("No judge is configured (`judges.routes` is empty).");
  else if (changed.length === 0) out.push("Nothing changed: no judge to launch.");
  else {
    for (const { agent, ground, files: touched } of routesFor(routes, changed)) {
      out.push(
        touched.length
          ? `- \`${agent}\` — launch: ${touched.map((f) => `\`${f}\``).join(", ")}.`
          : `- \`${agent}\` — skip: touches none of ${ground.map((g) => `\`${g}\``).join(", ")}.`,
      );
    }
  }
  const protocol = readFileSync(path.join(PLUGIN_ROOT, "skills", skill, "SKILL.md"), "utf8");
  out.push("", "## The caller", "", section(protocol, "The caller") ?? `(${skill} has no § The caller)`);
  return out.join("\n");
}
