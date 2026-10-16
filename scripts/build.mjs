#!/usr/bin/env node
/**
 * build.mjs - assemble the distributable extension into dist/.
 *
 * - bundles src/background.src.js (core engine inlined from the dualtran npm
 *   package) into dist/background.js as a single ES module;
 * - bundles src/shared/dualSpan.mjs into an IIFE exposing window.__dtDualSpan
 *   (content scripts share one window scope, so the plain script can use it);
 * - copies manifest, content scripts, css, options page, locales and icons.
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// 1) background bundle (core inlined)
await build({
  entryPoints: [path.join(ROOT, "src/background.src.js")],
  outfile: path.join(DIST, "background.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["firefox128"],
  define: { "process.env.NODE_ENV": '"production"', __DT_SMOKE__: String(!!process.env.DT_SMOKE) },
  minify: true,
  // The core ships a Node-only file cache factory; the extension stubs it out.
  alias: {
    "node:fs": path.join(ROOT, "scripts/stubs/node-fs.js"),
    "node:path": path.join(ROOT, "scripts/stubs/node-path.js"),
  },
  logLevel: "warning",
});

// 2) content scripts: self-contained IIFE bundles (the shared dual-span
// module is inlined, so no cross-file globals are needed in the sandbox)
for (const [entry, out] of [
  ["src/messageDisplay/content.js", "messageDisplay/content.js"],
  ["src/compose/content.js", "compose/content.js"],
]) {
  await build({
    entryPoints: [path.join(ROOT, entry)],
    outfile: path.join(DIST, out),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["firefox128"],
    define: { __DT_SMOKE__: String(!!process.env.DT_SMOKE) },
    logLevel: "warning",
  });
}

// 3) static copies
const copy = (from, to) => {
  const src = path.join(ROOT, from);
  const dst = path.join(DIST, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
  console.log("[build] copied", from, "->", to);
};
copy("manifest.json", "manifest.json");
copy("src/options", "options");
copy("_locales", "_locales");
copy("icons", "icons");

console.log("[build] dist ready:", DIST);
