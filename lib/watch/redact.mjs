/**
 * Strips secrets from the text stickler watch keeps of a tool call. Pure, no
 * Node built-in: the hook stores only redacted text, and the page's sentences
 * pass through it again, so what a past version missed when it wrote an event
 * is caught when the event is shown.
 *
 * What it catches: URLs with credentials, `Authorization` headers, an
 * assignment, a JSON member or a `--flag` whose name says secret (key, token,
 * password, …), `curl -u user:password`, every assignment of a command that
 * writes an env file, and well-known token shapes. A secret in a plain
 * argument with none of these marks is not caught; no tool output is kept,
 * which is where most of them would be.
 */
export const REDACTED = "[redacted]";

const NAME = String.raw`[A-Za-z0-9_.-]*?(?:key|token|secret|passw(?:or)?d|pwd|credentials?|auth|cookie)(?:[_.-][A-Za-z0-9_.-]*)?`;
const VALUE = String.raw`[^\s'"&;|,}]+`;

const rules = [
  // scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:'"]+:[^\s/@'"]*@/giu, `$1${REDACTED}@`],
  // Well-known token shapes, wherever they stand.
  [
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/gu,
    REDACTED,
  ],
  // Authorization: Bearer abc · API_KEY=abc · "password": "abc"
  [
    new RegExp(String.raw`\b((?:proxy-)?authorization|${NAME})(['"]?\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?(['"]?)${VALUE}`, "giu"),
    `$1$2$3${REDACTED}`,
  ],
  // --token abc · --password=abc
  [new RegExp(String.raw`(--${NAME})(=|\s+)(['"]?)(?!-)${VALUE}`, "giu"), `$1$2$3${REDACTED}`],
  // curl -u user:password
  [/(\s(?:-u|--user)\s+['"]?)([^\s:'"]+):[^\s'"]+/gu, `$1$2:${REDACTED}`],
];

/** Writing to an env file: `> .env`, `>> .env.local`, `tee -a .env`. */
const WRITES_ENV = /(?:>>?|\btee\b(?:\s+-a)?)\s*['"]?[^\s'"]*\.env(?:\.[\w-]+)?\b/u;
const ASSIGNMENT = /\b([A-Za-z_][A-Za-z0-9_]*)=(?:'[^']*'|"[^"]*"|[^\s'"]+)/gu;

/** The text with every secret it shows replaced by `[redacted]`. */
export function redact(text) {
  if (typeof text !== "string") return text;
  let out = text;
  if (WRITES_ENV.test(out)) out = out.replace(ASSIGNMENT, `$1=${REDACTED}`);
  for (const [pattern, replacement] of rules) out = out.replace(pattern, replacement);
  return out;
}

/** Redacted, then cut to `max` characters with an ellipsis; undefined for a non-string. */
export function clip(text, max = 300) {
  if (typeof text !== "string") return undefined;
  const clean = redact(text);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
