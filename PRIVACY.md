# Privacy policy — DualTran for Thunderbird

_Last updated: 2026-10-16_

DualTran for Thunderbird is an open-source translation add-on. It has **no
developer server, no analytics, no telemetry and no tracking of any kind**.

## What data leaves your machine

Only when you press the Translate button:

- The **text blocks of the message you chose to translate** are sent to the
  translation engine you selected:
  - **Google** (default): `https://translate.googleapis.com` — Google's
    translation service.
  - **AI (BYOK)**: directly to the provider you configured (e.g. OpenAI,
    DeepSeek, OpenRouter, a local Ollama endpoint, …). Requests go straight
    from your machine to that provider; nothing passes through us.
- The original message is never modified — translations are rendered as
  additional blocks in the reading pane / compose window only.

Nothing is sent unless you explicitly trigger a translation.

## What is stored locally

- Your settings (target language, engine choice, AI provider/key/model/base
  URL) are stored in Thunderbird's local extension storage on your machine.
  The API key never leaves your machine except as an authorization header to
  the provider you chose yourself.

## What we never do

- No accounts, no sign-up, no ads.
- No collection of message contents, subjects, addresses or metadata.
- No remote code loading.

## Contact

Issues and questions: https://github.com/seigwen/dualtran-thunderbird/issues
