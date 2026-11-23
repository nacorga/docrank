#!/usr/bin/env node
/**
 * docrank watch's observer: every hook event it is wired to becomes one line
 * in the session's watch log (`lib/watch/record.mjs`), which the watch server
 * tails for the browser tab.
 *
 * Unlike the guards, it fails open. It watches and decides nothing, so a
 * broken config, an unwritable home or a bug here must cost the session
 * nothing: it always exits 0 and never prints, which Claude Code reads as no
 * decision (harness fact 20). With `watch.enabled` off, or a config that does
 * not validate, it leaves before touching the disk. It is wired with
 * `async: true` (fact 19), so even then the session does not wait for it.
 *
 * At `SessionStart` it also starts the watch server when none runs, and opens
 * the page when no tab is connected (`lib/watch/launch.mjs`).
 */
import { readFileSync } from "node:fs";

try {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const { loadConfig } = await import("../lib/config.mjs");
  let config;
  try {
    config = loadConfig({ cwd: input.cwd || process.cwd() });
  } catch {
    process.exit(0);
  }
  if (config.watch.enabled) {
    const { append, repoKey, toRecord } = await import("../lib/watch/record.mjs");
    append(input, config, toRecord(input, config));
    if (input.hook_event_name === "SessionStart") {
      // The page opens once per machine: a connected tab follows the new session.
      const { ensureServer, openTab, pageUrl } = await import("../lib/watch/launch.mjs");
      const server = await ensureServer(config.watch.port);
      if (server && server.tabs === 0) {
        openTab(pageUrl(server, { lang: config.watch.language, repo: repoKey(config.root), session: input.session_id }));
      }
    }
  }
} catch {}
process.exit(0);
