/**
 * Loads `.claude/stickler.json` from the repository root. Every hook and skill
 * reads its settings through `loadConfig`, so the shape lives only here and
 * `docs/config.md` documents each key once.
 *
 * Validation is by hand: no schema library, because the plugin has no run-time
 * dependency. Every problem found is reported at once, each naming its key path
 * and what was expected. An absent file is every default; a key with no sane
 * default is optional and the feature that reads it stays off.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_FILE = ".claude/stickler.json";

export class ConfigError extends Error {
  constructor(errors) {
    super(`Invalid ${CONFIG_FILE}:\n${errors.map((e) => `  ${e}`).join("\n")}`);
    this.name = "ConfigError";
    this.errors = errors;
  }
}

/* The schema is data: a leaf says its type and default, `obj` nests. */
const str = (def = null) => ({ t: "str", def });
const regex = (def = null) => ({ t: "regex", def });
/** A regex a key may leave empty to mean off: its default, and an explicit "". */
const optionalRegex = () => ({ ...regex(""), empty: true });
/** A positive number: hours, or any measure that is not a count. Absent means `def`. */
const num = (def = null) => ({ t: "num", def });
const bool = (def) => ({ t: "bool", def });
const int = (def, min = 0, max = Infinity) => ({ t: "int", def, min, max });
const oneOf = (def, values) => ({ t: "enum", def, values });
const list = (item, def = []) => ({ t: "list", item, def });
const map = (item) => ({ t: "map", item, def: {} });
const obj = (shape) => ({ t: "obj", shape });
const req = (leaf) => ({ ...leaf, required: true });
/** A string, or a non-empty array of strings: one rank of a ladder that several prefixes may share. */
const rank = () => ({ t: "rank", def: null });

/** Regular expression flags beyond the `u` every pattern has: some of `i`, `m`, `s`, each once. */
const flags = () => ({ t: "flags", def: "" });
/** A version, `major.minor.patch`: the floor a repository holds the plugin to. */
const version = () => ({ t: "version", def: null });

/** A string checked by `a`, or an object checked by `b`: what a key that grew a second shape takes. */
const either = (a, b) => ({ t: "either", a, b });

const strings = () => list(str());

// The fields the integration branch decides are null here and filled in by
// `loadConfig`: a default that depends on another key cannot be a constant.
const schema = obj({
  requires: version(),
  branches: obj({
    protected: list(str(), ["main", "master"]),
    integration: str("main"),
    allowedPrBases: list(str(), null),
    baseFreshHours: num(),
  }),
  guard: obj({
    blockedTagPatterns: list(regex()),
    publishBan: bool(true),
    extraDeny: list(obj({ pattern: req(regex()), flags: flags(), reason: req(str()) })),
  }),
  gates: obj({
    run: list(obj({ name: req(str()), command: req(str()) })),
    jobs: map(str()),
    groups: map(list(str())),
    prelude: str(""),
    preflight: str(""),
    requireBeforePush: bool(true),
    record: str("stickler-gates-passed"),
  }),
  dispatch: obj({
    defaultModel: str("sonnet"),
    defaultEffort: oneOf("medium", ["low", "medium", "high", "xhigh", "max"]),
    heavyMarker: bool(true),
    forkBan: bool(true),
    guardrailsFile: str(),
  }),
  judges: obj({
    skill: str("judge-protocol"),
    maxRechecks: int(3, 1),
    routes: list(obj({ agent: req(str()), ground: req(strings()) })),
  }),
  paths: obj({
    builtIns: bool(true),
    rules: list(
      obj({
        pattern: req(regex()),
        onlyIfTracked: bool(false),
        reason: req(str()),
      }),
    ),
  }),
  plan: obj({ requiredHeadings: strings() }),
  format: obj({
    command: str(),
    lintCommand: str(),
    lintExtensions: strings(),
  }),
  docDrift: obj({
    baseRef: str(),
    entries: list(obj({ code: req(strings()), docs: req(strings()) })),
    unpaired: map(str()),
  }),
  worktree: obj({
    copy: list(str(), [".env", ".mcp.json"]),
    install: str(),
    prune: bool(false),
  }),
  pr: obj({
    productPaths: strings(),
    requiredLines: list(either(regex(), obj({ pattern: req(regex()), paths: req(strings()) }))),
    checklist: str(
      "Before this pull request opens, confirm that its description says what changed and why, and that the gates passed on this branch. Then run the same command again.",
    ),
    ciBases: list(str(), null),
    baseDraft: obj({ paths: list(str(), null) }),
  }),
  docs: obj({
    precedence: list(rank()),
    invariants: str(),
    registry: str(),
    scanRoots: strings(),
    historyRoots: strings(),
    unitRoots: strings(),
    groups: list(obj({ name: req(str()), paths: req(strings()) })),
  }),
  surface: obj({
    paths: strings(),
    widths: list(int(0, 1), [320, 375, 1280, 1440]),
    locales: strings(),
    criterion: str(),
  }),
  ship: obj({
    plansDir: str("docs/plans"),
    pathJobs: list(obj({ paths: req(strings()), jobs: req(strings()) })),
  }),
  principles: obj({
    enabled: bool(true),
    reportLanguage: str("English"),
    closingLine: str(),
  }),
  handoff: obj({
    enabled: bool(true),
    tokenThreshold: int(250000, 1),
    location: str("plan"),
  }),
  memory: obj({ link: bool(false) }),
  watch: obj({
    enabled: bool(false),
    port: int(47173, 1025, 65535),
    language: oneOf("en", ["en", "es"]),
    retentionDays: int(30, 1),
  }),
  messages: obj({
    tools: list(regex()),
    evidenceHeader: optionalRegex(),
    checklist: str(
      "Before this message leaves, check every sentence of it. Each fact is proved by a source over exactly what the sentence states; each inference is phrased as a question or left out. Show the claims with their sources under the draft, then send the same call again; a changed message is checked again.",
    ),
  }),
  // Session hygiene: what a prompt carries in, what a session left running,
  // which plan a session resumes from. Each is off until set.
  prompts: obj({
    context: list(obj({ match: req(regex()), file: req(str()) })),
  }),
  reap: obj({
    enabled: bool(false),
    keep: list(regex()),
  }),
  plans: obj({ atStart: bool(false) }),
});

const FLAGS = /^(?!.*(.).*\1)[ims]+$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;

/** The plugin's own version, from the manifest beside `lib/`. */
export const pluginVersion = () =>
  JSON.parse(
    readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json"), "utf8"),
  ).version;

/** Whether version `a` is older than `b`, compared as numbers part by part. */
export const older = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  const i = x.findIndex((n, k) => n !== y[k]);
  return i !== -1 && x[i] < y[i];
};

const expected = (leaf) => {
  switch (leaf.t) {
    case "str":
      return "a string";
    case "regex":
      return "a string holding a regular expression";
    case "bool":
      return "true or false";
    case "num":
      return "a number > 0";
    case "int":
      return leaf.max === Infinity ? `an integer >= ${leaf.min}` : `an integer from ${leaf.min} to ${leaf.max}`;
    case "enum":
      return `one of ${leaf.values.map((v) => `"${v}"`).join(", ")}`;
    case "list":
      return "an array";
    case "rank":
      return "a string or a non-empty array of strings";
    case "either":
      return `${expected(leaf.a)} or an object`;
    case "flags":
      return 'a string of some of "i", "m", "s", each once';
    case "version":
      return 'a version such as "1.2.3"';
    default:
      return "an object";
  }
};

const describe = (v) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "object") return "an object";
  return typeof v === "string" ? `"${v}"` : String(v);
};

/** Returns the value with defaults applied; pushes one message per problem. */
function check(leaf, value, at, errors) {
  const fail = (what = expected(leaf)) => {
    errors.push(`${at || "(top level)"}: expected ${what}, got ${describe(value)}`);
    return undefined;
  };
  switch (leaf.t) {
    case "str":
      return typeof value === "string" && value !== "" ? value : fail();
    case "regex":
      if (value === "" && leaf.empty) return value;
      if (typeof value !== "string" || value === "") return fail();
      try {
        new RegExp(value, "u");
        return value;
      } catch (e) {
        return fail(`a valid regular expression (${e.message})`);
      }
    case "bool":
      return typeof value === "boolean" ? value : fail();
    case "num":
      return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fail();
    case "either":
      return value !== null && typeof value === "object" && !Array.isArray(value)
        ? field(leaf.b, value, at, errors)
        : field(leaf.a, value, at, errors);
    case "flags":
      return typeof value === "string" && FLAGS.test(value) ? value : fail();
    case "version":
      return typeof value === "string" && VERSION.test(value) ? value : fail();
    case "rank":
      return (typeof value === "string" && value !== "") ||
        (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v !== ""))
        ? value
        : fail();
    case "int":
      return Number.isInteger(value) && value >= leaf.min && value <= leaf.max ? value : fail();
    case "enum":
      return leaf.values.includes(value) ? value : fail();
    case "list":
      if (!Array.isArray(value)) return fail();
      return value.map((item, i) => field(leaf.item, item, `${at}[${i}]`, errors));
    case "map":
      if (value === null || typeof value !== "object" || Array.isArray(value)) return fail();
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, field(leaf.item, v, `${at}.${k}`, errors)]),
      );
    default: {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return fail();
      const known = Object.keys(leaf.shape);
      for (const key of Object.keys(value)) {
        if (!known.includes(key)) {
          errors.push(`${at ? `${at}.${key}` : key}: unknown key (expected one of: ${known.join(", ")})`);
        }
      }
      return Object.fromEntries(
        known.map((key) => [key, field(leaf.shape[key], value[key], at ? `${at}.${key}` : key, errors)]),
      );
    }
  }
}

function field(leaf, value, at, errors) {
  if (value !== undefined) return check(leaf, value, at, errors);
  if (leaf.required) {
    errors.push(`${at}: expected ${expected(leaf)}, got nothing`);
    return undefined;
  }
  if (leaf.t === "obj") return check(leaf, {}, at, errors);
  return structuredClone(leaf.def);
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** The git top level of `cwd`, else CLAUDE_PROJECT_DIR. */
export function findRoot({ cwd = process.cwd(), env = process.env } = {}) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    if (env.CLAUDE_PROJECT_DIR) return env.CLAUDE_PROJECT_DIR;
    throw new ConfigError([
      "no repository root: cwd is not in a git repository and CLAUDE_PROJECT_DIR is not set",
    ]);
  }
}

export function loadConfig(options = {}) {
  const root = findRoot(options);
  const file = path.join(root, CONFIG_FILE);
  let raw = {};
  if (existsSync(file)) {
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      throw new ConfigError([`${CONFIG_FILE}: expected valid JSON (${e.message})`]);
    }
  }

  const errors = [];
  const config = check(schema, raw, "", errors);
  if (errors.length === 0) {
    const { requires, branches, docDrift, pr, gates, ship } = config;
    const own = pluginVersion();
    if (requires && older(own, requires)) {
      // Every guard reads the config, so a refused load is a refusal of each.
      throw new ConfigError([
        `requires: this repository needs stickler ${requires} or newer and stickler ${own} is installed. Run: claude plugin update stickler@stickler`,
      ]);
    }
    const integration = branches.integration;
    branches.allowedPrBases ??= [integration];
    pr.ciBases ??= [integration];
    docDrift.baseRef ??= `origin/${integration}`;

    const names = gates.run.map((g) => g.name);
    names.forEach((name, i) => {
      if (names.indexOf(name) !== i) {
        errors.push(`gates.run[${i}].name: expected a name used once, got "${name}" again`);
      }
    });
    Object.entries(gates.groups).forEach(([group, members]) => {
      if (names.includes(group) || Object.hasOwn(gates.jobs, group)) {
        errors.push(`gates.groups.${group}: expected a name no gate or job has`);
      }
      if (members.length === 0) errors.push(`gates.groups.${group}: expected at least one job`);
      members.forEach((job, j) => {
        if (!Object.hasOwn(gates.jobs, job)) {
          errors.push(`gates.groups.${group}[${j}]: expected a key of gates.jobs, got "${job}"`);
        }
      });
    });
    ship.pathJobs.forEach((entry, i) =>
      entry.jobs.forEach((job, j) => {
        if (!Object.hasOwn(gates.jobs, job)) {
          errors.push(`ship.pathJobs[${i}].jobs[${j}]: expected a key of gates.jobs, got "${job}"`);
        }
      }),
    );
    // A context file is the repository's: what a prompt carries in is never
    // read from outside it.
    config.prompts.context.forEach(({ file }, i) => {
      if (path.isAbsolute(file) || path.normalize(file).split(/[\\/]/u)[0] === "..") {
        errors.push(`prompts.context[${i}].file: expected a path inside the repository, got "${file}"`);
      }
    });
  }
  if (errors.length > 0) throw new ConfigError(errors);
  return deepFreeze({ root, ...config });
}
