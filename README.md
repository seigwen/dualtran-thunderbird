# DualTran for Thunderbird

**Bilingual email translation in your mail client.** The original message stays
untouched; the translation appears right below each block (original + translation
side by side). Google engine free by default; bring your own AI model (BYOK, any
OpenAI-compatible endpoint) for better quality.

Part of the [DualTran](https://github.com/seigwen/DualTran-extension) family —
the same translation core (`dualtran` on npm) that powers the browser extension,
the MCP server, the n8n node and the workbench hosts.

## Features

- **Reading pane**: a floating Translate button injects the bilingual view for
  the message you are reading; click again to go back to the original.
- **Compose window**: the same button translates the message you are writing
  (translation inserted below each block, original untouched).
- **Engines**: Google (free, no account) by default; switch to AI (BYOK) in the
  options page — provider, model, key and optional base URL are stored locally
  in Thunderbird only.
- 10 common target languages selectable (defaults to your Thunderbird UI
  language on first run).

## Install

- From Thunderbird Add-ons (AMO): _coming with the 0.1 release._
- Development: `npm install && npm run build`, then load `dist/` — e.g. copy
  `dist/` to `<profile>/extensions/dualtran@seigwen.dev/` with
  `xpinstall.signatures.required=false` for testing builds.

## Development

```bash
npm install        # installs the dualtran core from npm + build-time deps
npm test           # vitest: engine, settings, background wiring, dual-span DOM
npm run build      # esbuild: background bundle (core inlined) + content scripts
npm run verify     # tests + build + dist guards
DT_SMOKE=1 npm run build   # smoke build: auto-translates on message open
```

The real-Thunderbird smoke (`xvfb` + a sideloaded profile + a Spanish `.eml`)
is documented in the plan-72 record; the extension has been verified end-to-end
against Thunderbird 158 with the Google engine.

## Reproducing the submitted build (for reviewers)

The step-by-step build instructions for the listed version live in
[BUILD-src.md](./BUILD-src.md) (environment requirements, exact commands,
file map and artifact hashes). In short:

```bash
npm ci          # exact dependency graph from package-lock.json (Node >= 22)
npm run verify  # tests + build (esbuild, scripts/build.mjs) + dist guards
cd dist && zip -r ../dualtran-thunderbird-0.1.0.zip .   # package = contents of dist/
```

## License

MPL-2.0 (same as the DualTran core and browser extension; TWP lineage noted in
the main repository).
