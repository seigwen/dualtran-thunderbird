# Source-code submission — DualTran for Thunderbird 0.1.0

This archive accompanies the listed add-on **DualTran** (version 0.1.0)
submitted to addons.thunderbird.net. It contains the complete, unminified
source of the add-on, plus everything needed to reproduce the submitted
package exactly.

## Source of record

- Repository: https://github.com/seigwen/dualtran-thunderbird
- This archive was exported from **tag `v0.1.0`** of that repository.

## What was submitted

The submitted package is the **content of `dist/`** after `npm run build`
(no top-level folder inside the zip). It contains these 12 files:

| File | Role |
|---|---|
| `manifest.json` | MV3 mail extension manifest (gecko id `dualtran@seigwen.dev`, permissions `scripting`/`compose`/`messagesRead`/`storage`) |
| `background.js` | event page: script registration, message routing, translation engine (minified build output) |
| `messageDisplay/content.js` | reading-pane content script (bundle) |
| `compose/content.js` | compose-window content script (bundle) |
| `options/options.html`, `options/options.js` | settings page |
| `_locales/en|zh_CN/messages.json` | UI strings |
| `icons/16|32|64|128.png` | icons |

## Build environment requirements

- **OS**: Linux x86_64 (developed and verified on Ubuntu, kernel 6.8).
  Any Linux/macOS/Windows with Node.js ≥ 22 works — the build is
  platform-independent.
- **Node.js**: v22.23.1 (any 22.x is expected to work; https://nodejs.org).
  The repository CI reproduces the build on GitHub Actions `ubuntu-latest`
  with the same Node 22 line.
- **npm**: 10.9.8 (bundled with Node.js 22; no separate install).
- **Build tooling** (installed automatically by `npm ci`, versions pinned in
  `package-lock.json`): esbuild 0.28.2 (bundler), vitest 5.0.5 and jsdom 30.1.3
  (tests only).
- **Network**: access to https://registry.npmjs.org to fetch dependencies.

## Step-by-step build (produces the submitted package)

```bash
# 1) install the exact dependency graph from the lockfile
npm ci

# 2) build (runs scripts/build.mjs — the build script for all steps below)
npm run build

# 3) (recommended) reproducibility gate: tests + rebuild + artifact guards
npm run verify

# 4) package: zip the CONTENTS of dist/ (files at the archive root)
cd dist && zip -r ../dualtran-thunderbird-0.1.0.zip .
```

Notes:

- Do **not** set the `DT_SMOKE` environment variable. It is a test-only build
  switch used by the project's automated real-Thunderbird smoke test; the
  submitted package was built **without** it (it defaults to off).
- In the original development environment the packaging step was done with an
  equivalent Python `zipfile` pass over `dist/` (same layout: files at the
  archive root, no top-level folder).

### What the build script does (`scripts/build.mjs`)

1. **`dist/background.js`** — esbuild (`format: esm`, `target: firefox128`,
   minify) bundles `src/background.src.js`, which imports the host-agnostic
   translation core from the npm package `dualtran` (same author, MPL-2.0) and
   the local modules `src/engine.js`, `src/settings.js`, `src/background.js`.
   The core's Node-only file-cache module is replaced with the stubs under
   `scripts/stubs/` via esbuild `alias` (the extension never uses it).
2. **`dist/messageDisplay/content.js`** and **`dist/compose/content.js`** —
   self-contained IIFE bundles of `src/messageDisplay/content.js` and
   `src/compose/content.js`, which import the shared dual-span DOM logic from
   `src/shared/dualSpan.mjs`.
3. **Static copies** — `manifest.json`, `src/options/`, `_locales/`,
   `icons/` are copied into `dist/` unchanged.

## Unmodified sources vs. generated output (policy compliance)

- All first-party sources in this archive (`src/**`, `scripts/**`, `tests/**`,
  `manifest.json`, `_locales/**`, `options` sources) are **hand-written,
  unminified and not machine-generated**.
- The only processing is applied to the **build output** (`dist/background.js`
  is minified/transpiled by esbuild; the two content-script bundles are
  concatenated but not minified). The build is fully reproducible from this
  source with the steps above.
- **Third-party libraries are NOT included in this archive** (as permitted);
  they are fetched from npm per `package-lock.json`:
  - runtime: `dualtran@1.0.0` (the author's own translation core, MPL-2.0),
    `@ai-sdk/*` (Vercel AI SDK provider packages), `ai`, `common-tags`,
    `eventsource-parser` — all bundled into `background.js` at build time;
  - build/test only: `esbuild`, `vitest`, `jsdom`.

## Reproducibility checks

- sha256 of the key built artifacts **as they appear in the submitted
  package**:
  - `background.js` → `47ac472e98522a409fc1b2803aeee9482d03c34ec62d1b6fd09e4a4cc446eb35`
  - `messageDisplay/content.js` → `c9ad3851d8c032a0cde23f3a067c812fec3d9503687a4dc6bd588dda19324493`
  - `compose/content.js` → `ed43b07bc4ca392f41e85f560fc57b47b1228c178432f6225dabcebc559d5d57`
- `npm run verify` must pass: 29 unit/integration tests (engine, settings,
  background routing, dual-span DOM injection, manifest guards) + dist
  artifact guards.
- The same verify runs in CI on every push:
  https://github.com/seigwen/dualtran-thunderbird/actions

## Notes for the reviewer

- The reading-pane and compose UIs are registered via the Thunderbird MV3
  APIs `scripting.messageDisplay.registerScripts` and
  `scripting.compose.registerScripts`; the content bundles inject a floating
  button that inserts bilingual (original + translation) blocks.
- Translation flows: Google (default, free) or a user-configured
  OpenAI-compatible provider (BYOK). Requests go directly from the extension
  to the selected service; there is no developer server (see `PRIVACY.md`).
