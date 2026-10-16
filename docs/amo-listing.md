# AMO listing draft — DualTran for Thunderbird (v0.1.0)

## Name
DualTran – Email Translation

## Summary (250 chars)
Bilingual email translation: the original stays, the translation appears right
below each block. Google free by default; bring your own AI model (BYOK, 20+
providers) for higher quality. No account, no tracking, no middle server.

## Description
DualTran translates the message you are reading — and the one you are writing —
into a **dual-span bilingual view**: every original block is followed by its
translation, so you can read both at a glance without switching back and forth.

**Engines**
- **Google (default, free)** — no account or key required.
- **Your own AI model (BYOK)** — any OpenAI-compatible provider: OpenAI,
  Anthropic, Gemini, DeepSeek, Groq, OpenRouter, or a local Ollama. Your key is
  stored locally in Thunderbird and goes only to the provider you choose.

**Reading pane**: floating Translate button → bilingual view; press again to
return to the original.
**Compose window**: translate your draft before sending.
**Target language**: 10 common languages; defaults to your Thunderbird UI
language.

Part of the open-source DualTran family (browser extension, MCP server, n8n
node, workbench hosts) — same translation core, MPL-2.0.

## Permissions justification
- `storage` — save your settings (target language, engine choice, BYOK key).
- `messagesRead` — read the *currently displayed* message text for translation.
- `compose` — translate the content of the compose window you have open.
- `scripting` — inject the bilingual view into the message display and compose
  documents.
- Host `https://translate.googleapis.com/*` — the default translation engine.

## Data practices
- No data collection, no analytics, no developer server (see PRIVACY.md).
- Translated text goes only to the engine you selected, only when you trigger
  a translation.

## Review notes (for AMO reviewers)
- The extension works on any message, including local .eml files opened from
  disk — a Spanish sample message + screenshots are provided in the submission.
- Compose translation inserts translation blocks in the editor DOM; the
  original text is never modified.
- The options page is reachable via the Add-ons Manager; no account required.

## Version history
- 0.1.0 — first release: dual-span reading pane + compose translation, Google +
  BYOK engines, options page.
