import { describe, expect, it } from "vitest";
import { LANGUAGES, phrase, words } from "./phrases.mjs";

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
  ["Agent", { description: "Find the API" }, "Ask a helper to find the API", "Pedir a un ayudante: find the API"],
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
    });
    expect(phrase({ tool: "Bash", input: { command: "git push" }, outcome: "refused" }, "es").text).toBe(
      "Intentó enviar el trabajo al repositorio compartido (push); una regla de seguridad lo impidió",
    );
    expect(phrase({ tool: "Read", input: { path: ".env" }, outcome: "denied" }).tone).toBe("warning");
  });

  it("marks a failure with its exit code, and a call still running", () => {
    expect(phrase({ tool: "Bash", input: { command: "npm test" }, outcome: "failed", exitCode: 1 })).toEqual({
      text: "Run the tests — it failed",
      detail: "npm test\nexit code 1",
      tone: "failed",
    });
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

describe("words", () => {
  it("falls back to English for another language", () => {
    expect(words("fr").state.working).toBe("Working");
    expect(words("es").state.permission).toBe("Esperando tu permiso");
  });

  it("has the same keys in every language", () => {
    const keys = (o) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v).map((s) => `${k}.${s}`) : [k])).sort();
    expect(keys(words("es"))).toEqual(keys(words("en")));
  });
});
