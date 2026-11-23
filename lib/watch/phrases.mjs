/**
 * The plain sentences docrank watch shows an observer who does not read a
 * terminal, in English and Spanish. Pure, for the browser bundle.
 *
 * An action reads as an infinitive phrase ("Run the tests"), so one form
 * serves the feed and the warning that wraps it ("Tried to run the tests; a
 * safety rule stopped it"). The exact command or path goes in `detail`,
 * folded on the page. Every value from the log passes through `redact` again
 * before it is shown: a rule added since the line was written still applies.
 */
import { clip } from "./redact.mjs";

export const LANGUAGES = ["en", "es"];

const text = {
  en: {
    state: { working: "Working", permission: "Waiting for your permission", answer: "Waiting for your answer", done: "Done" },
    status: { pending: "To do", in_progress: "In progress", completed: "Done", deleted: "Dropped" },
    helper: { working: "Working", done: "Finished" },
    claude: "Claude",
    free: "Work without a list",
    helperNamed: (type) => `Helper (${type})`,
    helperAnon: "Helper",
    noErrand: "an errand not named",
    detail: "detail",
    empty: "Nothing yet.",
    follow: "Follow the activity",
    session: "Session",
    waiting: "Waiting for a session with watch on…",
    lost: "Connection lost; trying again…",
    tried: (what) => `Tried to ${what}; a safety rule stopped it`,
    denied: (what) => `Tried to ${what}; it was not allowed`,
    failed: (what) => `${what} — it failed`,
    interrupted: (what) => `${what} — it was interrupted`,
    tool: {
      Read: (i) => `read ${i.path ?? "a file"}`,
      Write: (i) => `write ${i.path ?? "a file"}`,
      Edit: (i) => `change ${i.path ?? "a file"}`,
      NotebookEdit: (i) => `change the notebook ${i.path ?? ""}`.trim(),
      Glob: (i) => `look for files named ${i.pattern ?? "…"}${i.path ? ` in ${i.path}` : ""}`,
      Grep: (i) => `search the code for “${i.pattern ?? "…"}”${i.path ? ` in ${i.path}` : ""}`,
      WebFetch: (i) => `read the web page ${i.url ?? ""}`.trim(),
      WebSearch: (i) => `search the web for “${i.query ?? "…"}”`,
      Agent: (i) => `ask a helper to ${lower(i.description) || "help"}`,
      SendMessage: (i) => `send a message to ${i.to ?? "a helper"}`,
      Skill: (i) => (i.skill ? `follow the ${i.skill} procedure` : "follow a procedure"),
      TaskCreate: (i) => `add “${i.subject ?? "a task"}” to the list`,
      TaskUpdate: (i) =>
        i.status === "in_progress" ? "start a task" : i.status === "completed" ? "mark a task done" : i.status === "deleted" ? "drop a task" : "update a task",
      TodoWrite: () => "update the task list",
      TaskList: () => "look at the task list",
      TaskGet: () => "look at a task",
      Monitor: () => "watch a running command",
      PowerShell: (i) => (i.description ? `run a command: ${lower(i.description)}` : "run a command"),
    },
    gate: (name) => (name === "*" ? "run all the checks" : `run the “${name}” check`),
    bash: {
      tests: "run the tests",
      install: "install what the project needs",
      build: "build the project",
      commit: "save a version of the work (commit)",
      push: "send the work to the shared repository (push)",
      pull: "bring in the latest shared work",
      look: "look at what changed",
      branch: "switch to another line of work (branch)",
      merge: "combine two lines of work (merge)",
      prOpen: "open a pull request",
      pr: "check a pull request",
      git: "run a git command",
      files: "look through the files",
      command: (d) => (d ? `run a command: ${lower(d)}` : "run a command"),
    },
    mcp: (tool, server) => `use ${tool} from ${server}`,
    unknown: (tool) => `use the tool ${tool}`,
  },
  es: {
    state: { working: "Trabajando", permission: "Esperando tu permiso", answer: "Esperando tu respuesta", done: "Terminado" },
    status: { pending: "Por hacer", in_progress: "En curso", completed: "Hecha", deleted: "Descartada" },
    helper: { working: "Trabajando", done: "Terminó" },
    claude: "Claude",
    free: "Trabajo sin lista",
    helperNamed: (type) => `Ayudante (${type})`,
    helperAnon: "Ayudante",
    noErrand: "un encargo sin nombre",
    detail: "detalle",
    empty: "Nada todavía.",
    follow: "Seguir la actividad",
    session: "Sesión",
    waiting: "Esperando una sesión con watch activado…",
    lost: "Conexión perdida; reintentando…",
    tried: (what) => `Intentó ${what}; una regla de seguridad lo impidió`,
    denied: (what) => `Intentó ${what}; no se le permitió`,
    failed: (what) => `${what}: falló`,
    interrupted: (what) => `${what}: se interrumpió`,
    tool: {
      Read: (i) => `leer ${i.path ?? "un archivo"}`,
      Write: (i) => `escribir ${i.path ?? "un archivo"}`,
      Edit: (i) => `cambiar ${i.path ?? "un archivo"}`,
      NotebookEdit: (i) => `cambiar el cuaderno ${i.path ?? ""}`.trim(),
      Glob: (i) => `buscar archivos llamados ${i.pattern ?? "…"}${i.path ? ` en ${i.path}` : ""}`,
      Grep: (i) => `buscar «${i.pattern ?? "…"}» en el código${i.path ? ` de ${i.path}` : ""}`,
      WebFetch: (i) => `leer la página ${i.url ?? ""}`.trim(),
      WebSearch: (i) => `buscar en la web «${i.query ?? "…"}»`,
      Agent: (i) => (i.description ? `pedir a un ayudante: ${lower(i.description)}` : "pedir ayuda a un ayudante"),
      SendMessage: (i) => `enviar un mensaje a ${i.to ?? "un ayudante"}`,
      Skill: (i) => (i.skill ? `seguir el procedimiento ${i.skill}` : "seguir un procedimiento"),
      TaskCreate: (i) => `añadir «${i.subject ?? "una tarea"}» a la lista`,
      TaskUpdate: (i) =>
        i.status === "in_progress"
          ? "empezar una tarea"
          : i.status === "completed"
            ? "dar una tarea por hecha"
            : i.status === "deleted"
              ? "descartar una tarea"
              : "actualizar una tarea",
      TodoWrite: () => "actualizar la lista de tareas",
      TaskList: () => "mirar la lista de tareas",
      TaskGet: () => "mirar una tarea",
      Monitor: () => "vigilar un comando en marcha",
      PowerShell: (i) => (i.description ? `ejecutar un comando: ${lower(i.description)}` : "ejecutar un comando"),
    },
    gate: (name) => (name === "*" ? "pasar todas las comprobaciones" : `pasar la comprobación «${name}»`),
    bash: {
      tests: "pasar las pruebas",
      install: "instalar lo que el proyecto necesita",
      build: "construir el proyecto",
      commit: "guardar una versión del trabajo (commit)",
      push: "enviar el trabajo al repositorio compartido (push)",
      pull: "traer el último trabajo compartido",
      look: "mirar qué ha cambiado",
      branch: "cambiar a otra línea de trabajo (rama)",
      merge: "unir dos líneas de trabajo (merge)",
      prOpen: "abrir una pull request",
      pr: "revisar una pull request",
      git: "ejecutar un comando de git",
      files: "recorrer los archivos",
      command: (d) => (d ? `ejecutar un comando: ${lower(d)}` : "ejecutar un comando"),
    },
    mcp: (tool, server) => `usar ${tool} de ${server}`,
    unknown: (tool) => `usar la herramienta ${tool}`,
  },
};

const lower = (s) => (typeof s === "string" && s ? s[0].toLowerCase() + s.slice(1) : "");
const upper = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The words of a language, `en` for any other. */
export const words = (lang) => text[lang] ?? text.en;

/** Which family a shell command belongs to, by its first command. */
function family(command) {
  const c = command.trim().replace(/^(?:\w+=\S*\s+)+/u, "");
  if (/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|^npx\s+(?:vitest|jest|mocha|playwright\s+test)\b|^(?:vitest|jest|pytest|mocha)\b|^(?:go|cargo)\s+test\b|^node\s+--test\b|^python3?\s+-m\s+(?:pytest|unittest)\b/u.test(c)) return "tests";
  if (/^(?:npm\s+(?:install|i|ci)|pnpm\s+(?:install|i|add)|yarn(?:\s+(?:install|add))?|bun\s+(?:install|add)|pip3?\s+install|brew\s+install|cargo\s+fetch|go\s+mod\s+download)\b/u.test(c)) return "install";
  if (/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|^(?:make|cargo\s+build|go\s+build|tsc)\b/u.test(c)) return "build";
  const git = /^git\s+(?:-C\s+\S+\s+)?(\S+)/u.exec(c)?.[1];
  if (git) {
    if (git === "commit") return "commit";
    if (git === "push") return "push";
    if (["pull", "fetch"].includes(git)) return "pull";
    if (["status", "diff", "log", "show"].includes(git)) return "look";
    if (["checkout", "switch", "branch", "worktree"].includes(git)) return "branch";
    if (["merge", "rebase"].includes(git)) return "merge";
    return "git";
  }
  if (/^gh\s+pr\s+create\b/u.test(c)) return "prOpen";
  if (/^gh\s+pr\b/u.test(c)) return "pr";
  if (/^(?:ls|cat|head|tail|find|grep|rg|wc|tree)\b/u.test(c)) return "files";
  return null;
}

/** The infinitive phrase of a call, with every value redacted again. */
function what(w, action) {
  const i = Object.fromEntries(Object.entries(action.input ?? {}).map(([k, v]) => [k, typeof v === "string" ? clip(v, 200) : v]));
  const tool = action.tool ?? "";
  if (tool === "Bash") {
    if (action.gate) return w.gate(clip(action.gate, 60));
    const f = typeof i.command === "string" ? family(i.command) : null;
    return f ? w.bash[f] : w.bash.command(i.description);
  }
  if (w.tool[tool]) return w.tool[tool](i);
  const mcp = /^mcp__(.+?)__(.+)$/u.exec(tool);
  if (mcp) return w.mcp(clip(mcp[2], 60), clip(mcp[1].replace(/^plugin_[^_]+_/u, ""), 60));
  return w.unknown(clip(tool, 60) || "?");
}

/** What `detail` shows: the exact input, and why it was stopped. */
function detailOf(action) {
  const i = action.input ?? {};
  const lines = [i.command, i.path, i.pattern && `pattern: ${i.pattern}`, i.glob && `glob: ${i.glob}`, i.url, i.query, i.subagentType && `type: ${i.subagentType}`]
    .filter((v) => typeof v === "string" && v)
    .map((v) => clip(v, 500));
  if (action.exitCode != null) lines.push(`exit code ${action.exitCode}`);
  if (action.reason) lines.push(clip(String(action.reason), 300));
  return lines.join("\n");
}

/**
 * What a helper from the reducer was asked to do: its `Agent` call's
 * description, else the skill it was forked for, else null.
 */
export function errand(helper, lang = "en") {
  if (helper.errand) return helper.errand;
  return helper.skill ? upper(words(lang).tool.Skill({ skill: clip(helper.skill, 60) })) : null;
}

/**
 * One feed line for an action from the reducer: `text` to read, `detail`
 * to unfold, and `tone` (running, ok, failed, warning) for its colour.
 */
export function phrase(action, lang = "en") {
  const w = words(lang);
  const v = what(w, action);
  const outcome = action.outcome ?? "running";
  const [t, tone] =
    outcome === "refused"
      ? [w.tried(v), "warning"]
      : outcome === "denied"
        ? [w.denied(v), "warning"]
        : outcome === "failed"
          ? [w.failed(upper(v)), "failed"]
          : outcome === "interrupted"
            ? [w.interrupted(upper(v)), "failed"]
            : [upper(v), outcome === "ok" ? "ok" : "running"];
  return { text: t, detail: detailOf(action), tone };
}
