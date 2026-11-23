/**
 * `docrank watch [--no-open]`: the watch page without waiting for a session.
 * Starts the machine's watch server on `watch.port` when none runs, prints the
 * page's address and opens it, the way `SessionStart` does when watch is on.
 */
import { loadConfig } from "../config.mjs";
import { ensureServer, openTab, pageUrl } from "../watch/launch.mjs";

export default async function watch(args = []) {
  const unknown = args.filter((a) => a !== "--no-open");
  if (unknown.length) throw new Error(`unknown argument ${unknown[0]}; usage: docrank watch [--no-open]`);
  const config = loadConfig();
  const server = await ensureServer(config.watch.port, { retentionDays: config.watch.retentionDays });
  if (!server) throw new Error(`no watch server could start on port ${config.watch.port}: another program holds it (watch.port)`);
  const url = pageUrl(server, { lang: config.watch.language });
  if (!args.includes("--no-open")) openTab(url);
  const off = config.watch.enabled ? "" : "\nwatch.enabled is off in this repository: its sessions are not recorded.";
  return `${url}${off}`;
}
