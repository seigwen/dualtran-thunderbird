// Post-build artifact guards: fail loudly if the dist tree is not shippable.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist");
const fail = (msg) => { console.error("[guards] FAIL:", msg); process.exit(1); };
const ok = (msg) => console.log("[guards] ok:", msg);

const must = (rel) => {
  const p = path.join(DIST, rel);
  if (!fs.existsSync(p)) fail(`missing ${rel}`);
  return p;
};

// background bundle: single file, core inlined, no node builtins
const bg = fs.readFileSync(must("background.js"), "utf8");
if (bg.length < 150_000) fail(`background.js unexpectedly small (${bg.length}) - core not inlined?`);
if (/require\("node:|from "node:|import\("node:/.test(bg)) fail("node: builtin import leaked into the browser bundle");
ok(`background.js ${(bg.length / 1024).toFixed(0)}KB, no node builtins`);

// content scripts: self-contained bundles (helper inlined, no bare imports)
for (const rel of ["messageDisplay/content.js", "compose/content.js"]) {
  const code = fs.readFileSync(must(rel), "utf8");
  if (!code.includes("dt-fab")) fail(`${rel} does not look like the built content script`);
  if (/^\s*import\s/m.test(code)) fail(`${rel} still contains bare ESM imports (not bundled)`);
  ok(`${rel} bundled (${(code.length / 1024).toFixed(0)}KB)`);
}

for (const rel of [
  "manifest.json",
  "options/options.html",
  "options/options.js",
  "_locales/en/messages.json",
  "_locales/zh_CN/messages.json",
  "icons/128.png",
]) must(rel);
ok("static tree copied");

console.log("[guards] all checks passed");
