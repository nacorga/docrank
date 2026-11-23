import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANGUAGES, errand, helperChips, phrase, words } from "./phrases.mjs";
import { reduce } from "./reduce.mjs";

const say = (tool, input = {}, extra = {}, lang = "en") => phrase({ tool, input, outcome: "ok", ...extra }, lang).text;

const tools = [
  ["Read", { path: "src/a.js" }, "Read src/a.js", "Leer src/a.js"],
  ["Write", { path: "src/a.js" }, "Write src/a.js", "Escribir src/a.js"],
  ["Edit", { path: "src/a.js" }, "Change src/a.js", "Cambiar src/a.js"],
  ["NotebookEdit", { path: "n.ipynb" }, "Change the notebook n.ipynb", "Cambiar el cuaderno n.ipynb"],
  ["Glob", { pattern: "*.js", path: "src" }, "Look for files named *.js in src", "Buscar archivos llamados *.js en src"],
  ["Grep", { pattern: "login" }, "Search the code for “login”", "Buscar «login» en el código"],
  ["WebFetch", { url: "https://x.dev" }, "Read the web page https://x.dev", "Leer la página https://x.dev"],
  ["WebSearch", { query: "react flow" }, "Search the web for “react flow”", "Buscar en la web «react flow»"],
  ["Agent", { description: "Find the API" }, "Ask a subagent to find the API", "Pedir a un subagente: find the API"],
  ["SendMessage", { to: "a1" }, "Send a message to a1", "Enviar un mensaje a a1"],
  ["Skill", { skill: "gates" }, "Follow the gates procedure", "Seguir el procedimiento gates"],
  ["TaskCreate", { subject: "Add login" }, "Add “Add login” to the list", "Añadir «Add login» a la lista"],
  ["TaskUpdate", { status: "completed" }, "Mark a task done", "Dar una tarea por hecha"],
  ["TodoWrite", {}, "Update the task list", "Actualizar la lista de tareas"],
  ["Monitor", {}, "Watch a running command", "Vigilar un comando en marcha"],
  ["Bash", { command: "npm test" }, "Run the tests", "Pasar las pruebas"],
];

describe("phrase", () => {
  it.each(tools)("says %s in both languages", (tool, input, en, es) => {
    expect(say(tool, input)).toBe(en);
    expect(say(tool, input, {}, "es")).toBe(es);
  });

  it.each([
    ["CI=1 npx vitest run", "Run the tests"],
    ["pytest -q", "Run the tests"],
    ["npm ci", "Install what the project needs"],
    ["npm run build", "Build the project"],
    ["git commit -m x", "Save a version of the work (commit)"],
    ["git -C ../w push -u origin feat/x", "Send the work to the shared repository (push)"],
    ["git status", "Look at what changed"],
    ["gh pr create --base main", "Open a pull request"],
    ["ls -la", "Look through the files"],
  ])("knows the family of %s", (command, en) => {
    expect(say("Bash", { command })).toBe(en);
  });

  it("names a gate, or all of them", () => {
    expect(say("Bash", { command: "npm run lint" }, { gate: "lint" })).toBe("Run the “lint” check");
    expect(say("Bash", { command: "node run-gates.mjs" }, { gate: "*" }, "es")).toBe("Pasar todas las comprobaciones");
  });

  it("falls back to the description, then to a bare command", () => {
    expect(say("Bash", { command: "./deploy.sh", description: "Deploy staging" })).toBe("Run a command: deploy staging");
    expect(say("Bash", { command: "./x" }, {}, "es")).toBe("Ejecutar un comando");
  });

  it("has a sentence for an unknown or MCP tool", () => {
    expect(say("mcp__plugin_docrank_browser__browser_snapshot")).toBe("Use browser_snapshot from browser");
    expect(say("mcp__mail__send", {}, {}, "es")).toBe("Usar send de mail");
    expect(say("Frobnicate")).toBe("Use the tool Frobnicate");
    expect(say(undefined)).toBe("Use the tool ?");
  });

  it("reads a refusal as a warning, with the reason in the detail", () => {
    const p = phrase({ tool: "Bash", input: { command: "git push" }, outcome: "refused", reason: "BLOCKED: the gates have not passed" });
    expect(p).toEqual({
      text: "Tried to send the work to the shared repository (push); a safety rule stopped it",
      detail: "git push\nBLOCKED: the gates have not passed",
      tone: "warning",
      chips: [{ kind: "tool", text: "Bash" }],
    });
    expect(phrase({ tool: "Bash", input: { command: "git push" }, outcome: "refused" }, "es").text).toBe(
      "Intentó enviar el trabajo al repositorio compartido (push); una regla de seguridad lo impidió",
    );
    expect(phrase({ tool: "Read", input: { path: ".env" }, outcome: "denied" }).tone).toBe("warning");
  });

  it("marks a failure with its exit code, and a call still running", () => {
    expect(phrase({ tool: "Bash", input: { command: "npm test" }, outcome: "failed", exitCode: 1 })).toEqual({
      text: "Run the tests — failed",
      detail: "npm test\nexit code 1",
      tone: "failed",
      chips: [{ kind: "tool", text: "Bash ✗", verdict: "failed" }],
    });
    expect(phrase({ tool: "Bash", input: { command: "npm test" }, outcome: "failed" }, "es").text).toBe("Pasar las pruebas — falló");
    expect(phrase({ tool: "Bash", input: { command: "npm test" }, outcome: "interrupted" }).text).toBe("Run the tests — interrupted");
    expect(phrase({ tool: "Bash", input: { command: "npm test" }, outcome: "interrupted" }, "es").text).toBe("Pasar las pruebas — se interrumpió");
    expect(phrase({ tool: "Read", input: { path: "a" } }).tone).toBe("running");
  });

  it("shows no raw secret, in any language, even from a line written before a rule existed", () => {
    const secrets = { command: "curl -H 'Authorization: Bearer s3cr3t' -u bob:hunter2 https://x", description: "Use API_KEY=s3cr3t", url: "https://u:hunter2@x.dev", path: "ghp_abcdefghijklmnopqrstuv1234", query: "token=s3cr3t" };
    for (const lang of LANGUAGES) {
      for (const tool of ["Bash", "PowerShell", "WebFetch", "Read", "WebSearch", "Agent"]) {
        for (const outcome of ["ok", "refused", "failed"]) {
          const p = phrase({ tool, input: { ...secrets, description: secrets.description }, outcome, reason: "password=s3cr3t" }, lang);
          for (const s of ["s3cr3t", "hunter2", "ghp_abc"]) expect(`${p.text}\n${p.detail}`).not.toContain(s);
        }
      }
    }
  });
});

describe("chips", () => {
  const chips = (action, lang) => phrase({ input: {}, outcome: "running", ...action }, lang).chips;

  it.each(["Bash", "Read", "Edit", "Write", "Glob", "Grep", "Agent", "Skill", "WebFetch", "TaskCreate", "ToolSearch"])("names the tool %s as called", (tool) => {
    for (const lang of LANGUAGES) expect(chips({ tool }, lang)).toEqual([{ kind: "tool", text: tool }]);
  });

  it("shortens a plugin's MCP tool and keeps the full name as its title", () => {
    expect(chips({ tool: "mcp__plugin_docrank_browser__browser_snapshot" })).toEqual([
      { kind: "tool", text: "mcp__browser__browser_snapshot", title: "mcp__plugin_docrank_browser__browser_snapshot" },
    ]);
    expect(chips({ tool: "mcp__mail__send" })).toEqual([{ kind: "tool", text: "mcp__mail__send" }]);
  });

  it("names the gate a command runs, and the runner for all of them", () => {
    expect(chips({ tool: "Bash", gate: "lint" })).toEqual([{ kind: "tool", text: "Bash" }, { kind: "gate", text: "gate:lint" }]);
    expect(chips({ tool: "Bash", gate: "*" }, "es")).toEqual([{ kind: "tool", text: "Bash" }, { kind: "gate", text: "run-gates" }]);
  });

  it("marks the tool of a call that succeeded or failed, in every language", () => {
    for (const lang of LANGUAGES) {
      expect(chips({ tool: "Read", outcome: "ok" }, lang)).toEqual([{ kind: "tool", text: "Read ✓", verdict: "ok" }]);
      expect(chips({ tool: "Bash", outcome: "failed", exitCode: 2 }, lang)).toEqual([{ kind: "tool", text: "Bash ✗", verdict: "failed" }]);
      for (const outcome of ["running", "interrupted", "refused", "denied"]) expect(chips({ tool: "Bash", outcome }, lang)[0]).toEqual({ kind: "tool", text: "Bash" });
    }
  });

  it("says on the gate chip whether the gates passed", () => {
    for (const lang of LANGUAGES) {
      expect(chips({ tool: "Bash", gate: "*", outcome: "ok" }, lang)).toEqual([{ kind: "tool", text: "Bash" }, { kind: "gate", text: "run-gates ✓", verdict: "ok" }]);
      expect(chips({ tool: "Bash", gate: "*", outcome: "failed", exitCode: 1 }, lang)).toEqual([{ kind: "tool", text: "Bash" }, { kind: "gate", text: "run-gates ✗", verdict: "failed" }]);
      expect(chips({ tool: "Bash", gate: "lint", outcome: "failed" }, lang).at(-1)).toEqual({ kind: "gate", text: "gate:lint ✗", verdict: "failed" });
    }
    expect(phrase({ tool: "Bash", input: { command: "node scripts/run-gates.mjs" }, gate: "*", outcome: "failed" }).text).toBe("Run all the checks — failed");
    expect(phrase({ tool: "Bash", input: { command: "node scripts/run-gates.mjs" }, gate: "*", outcome: "failed" }, "es").text).toBe("Pasar todas las comprobaciones — falló");
    expect(phrase({ tool: "Bash", input: {}, gate: "*", outcome: "ok" }, "es").text).toBe("Pasar todas las comprobaciones");
  });

  it("names the guard of a refusal only", () => {
    expect(chips({ tool: "Bash", outcome: "refused", guard: "guard-bash" }, "es")).toEqual([{ kind: "tool", text: "Bash" }, { kind: "guard", text: "guard-bash" }]);
    expect(chips({ tool: "Read", outcome: "denied", guard: "guard-bash" })).toEqual([{ kind: "tool", text: "Read" }]);
  });

  it("has none for an action with no tool", () => {
    expect(chips({})).toEqual([]);
  });

  it("names a subagent's type and the skill it was forked for", () => {
    expect(helperChips({ type: "Explore", skill: null })).toEqual([{ kind: "type", text: "Explore" }]);
    expect(helperChips({ type: "general-purpose", skill: "docrank:gates" })).toEqual([
      { kind: "type", text: "general-purpose" },
      { kind: "skill", text: "docrank:gates" },
    ]);
    expect(helperChips({ type: null, skill: null })).toEqual([]);
  });

  it.each(["0.3.0", "0.4.0"])("reads the %s trial: subagent types, the gates skill, the runner and the push's guard", (version) => {
    const lines = readFileSync(new URL(`../../test/fixtures/watch-trial-${version}.jsonl`, import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const s = reduce(lines);
    const cards = s.helpers.map((h) => helperChips(h).map((c) => c.text));
    expect(cards).toContainEqual(["Explore"]);
    expect(cards).toContainEqual(["general-purpose", "docrank:gates"]);
    const actions = [...s.free.actions, ...s.tasks.flatMap((t) => t.actions), ...s.helpers.flatMap((h) => h.actions)];
    const all = (lang) => actions.map((a) => phrase(a, lang).chips.map((c) => c.text).join(" "));
    for (const lang of LANGUAGES) {
      expect(all(lang)).toContain("Bash run-gates ✓");
      expect(all(lang)).toContain("Skill ✓");
      if (version === "0.3.0") expect(all(lang)).toContain("Bash guard-bash");
    }
  });
});

describe("errand", () => {
  it("reads a helper's errand from its Agent call, else from its forked skill", () => {
    expect(errand({ errand: "Find the API", skill: null })).toBe("Find the API");
    expect(errand({ errand: null, skill: "docrank:gates" })).toBe("Follow the docrank:gates procedure");
    expect(errand({ errand: null, skill: "docrank:gates" }, "es")).toBe("Seguir el procedimiento docrank:gates");
    expect(errand({ errand: null, skill: null })).toBeNull();
  });
});

describe("words", () => {
  it("numbers the turns of a session without a list", () => {
    expect(words("en").turn(2)).toBe("Turn 2");
    expect(words("es").turn(2)).toBe("Turno 2");
  });

  it("calls a dispatched agent a subagent", () => {
    expect(words("en").helperAnon).toBe("Subagent");
    expect(words("es").helperAnon).toBe("Subagente");
    expect(words("en").helperNamed("Explore")).toBe("Subagent (Explore)");
    expect(words("es").helperNamed("Explore")).toBe("Subagente (Explore)");
    expect(say("SendMessage", {}, {}, "es")).toBe("Enviar un mensaje a un subagente");
    expect(say("Agent", {}, {}, "es")).toBe("Pedir ayuda a un subagente");
    const all = (o) => Object.values(o).flatMap((v) => (typeof v === "string" ? [v] : v && typeof v === "object" ? all(v) : []));
    for (const lang of LANGUAGES) expect(all(words(lang)).join(" ")).not.toMatch(/helper|ayudante/iu);
  });

  it("falls back to English for another language", () => {
    expect(words("fr").state.working).toBe("Working");
    expect(words("es").state.permission).toBe("Esperando tu permiso");
  });

  it("has the same keys in every language", () => {
    const keys = (o) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v).map((s) => `${k}.${s}`) : [k])).sort();
    expect(keys(words("es"))).toEqual(keys(words("en")));
  });
});
