#!/usr/bin/env node
/**
 * Builds the watch page, `ui/src/main.jsx`, into `ui/dist/watch.js` and
 * `ui/dist/watch.css`. The output is committed, so the plugin runs with no
 * npm install; React, React Flow and esbuild are dev dependencies only.
 * Minified with no source paths or legal comments, so the same sources give
 * the same bytes on every platform, which `ui/build.test.mjs` relies on.
 *
 *   node ui/build.mjs [outdir]       default ui/dist
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function build(outdir = path.join(ROOT, "ui", "dist")) {
  const { build: esbuild } = await import("esbuild");
  await esbuild({
    absWorkingDir: ROOT,
    entryPoints: { watch: "ui/src/main.jsx" },
    outdir,
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2020",
    jsx: "automatic",
    legalComments: "none",
    charset: "utf8",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await build(process.argv[2] && path.resolve(process.argv[2]));
