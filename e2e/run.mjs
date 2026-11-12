/**
 * run.mjs — Thunderbird E2E (host API stubbed, real shipped bundles).
 *
 * Two surfaces, both loaded from dist/ exactly as the extension ships them:
 *   • options page  — provider/model/reasoning dropdowns, save + restore
 *   • compose page  — content script injects the floating button, the dual-span
 *                     blocks and the busy spinner
 *
 * `browser.storage.local` is backed by localStorage so values survive a reload,
 * and `browser.runtime.sendMessage` is scripted per scenario (ok / slow / error).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DIST = path.join(ROOT, "dist");
const ARTIFACTS = path.join(ROOT, "e2e-artifacts");
const FIXTURE = fs.readFileSync(path.join(HERE, "fixtures", "modelsdev.json"), "utf8");

const COMPOSE_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>compose</title></head>
<body>
  <div id="messageEditor">
    <p>Hello world, this is the first paragraph.</p>
    <p>Second paragraph with more prose.</p>
  </div>
  <script src="/compose/content.js"></script>
</body></html>`;

const WEBEXT_STUB = (messageScript) => `
  (() => {
    const KEY = "__dt_e2e_store";
    const read = () => {
      try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
    };
    const write = (value) => localStorage.setItem(KEY, JSON.stringify(value));
    const messages = {
      optionMore: "more", optionCustomModel: "Custom model…", optionReasoning: "Reasoning effort",
      optionReasoningLowest: "Lowest (default)", optionReasoningDefault: "Provider default",
      optionProvider: "Provider", optionModel: "Model", optionBaseUrl: "Custom base URL",
      optionApiKey: "API key", optionSave: "Save", optionSaved: "Saved",
      btnComposeTranslate: "Translate", btnTranslating: "Translating…", btnShowOriginal: "Show original",
      errorTranslate: "Translation failed: $DETAIL$", optionTargetLang: "Target language",
      optionEngineGoogle: "Google", optionEngineAi: "AI (BYOK)", optionsTitle: "DualTran",
      extName: "DualTran", extDescription: "DualTran", optionApiKeyHint: "stored locally",
      providerPlaceholder: "Select a provider", providerRequiredForModel: "Select a provider first",
      providerRequiredError: "Choose an AI provider in settings before translating."
    };
    window.browser = {
      storage: {
        local: {
          async get(defaults) {
            const all = read();
            const out = {};
            for (const [key, fallback] of Object.entries(defaults || {})) {
              out[key] = Object.prototype.hasOwnProperty.call(all, key) ? all[key] : fallback;
            }
            return out;
          },
          async set(values) {
            const all = read();
            Object.assign(all, values);
            write(all);
          },
        },
      },
      i18n: { getMessage: (key) => messages[key] || key, getUILanguage: () => "en-US" },
      runtime: {
        lastError: null,
        async sendMessage(message) {
          // The real background persists dt-save-settings; the stub does the same
          // two-level merge so a reload can prove the values survived.
          if (message && message.command === "dt-save-settings") {
            const all = read();
            const merge = (base, patch) => {
              const out = { ...(base || {}) };
              for (const [key, value] of Object.entries(patch || {})) {
                out[key] =
                  value && typeof value === "object" && !Array.isArray(value)
                    ? merge(out[key], value)
                    : value;
              }
              return out;
            };
            all.dtSettings = merge(all.dtSettings, message.patch);
            write(all);
            return { ok: true };
          }
          // SPEC 2.1: the in-mail buttons ask for the engine + provider before
          // enabling themselves. Same shape the real background returns.
          if (message && message.command === "dt-settings") {
            const settings = read().dtSettings || {};
            return {
              settings: {
                engine: settings.engine || "google",
                targetLang: settings.targetLang || "en",
                ai: { provider: (settings.ai && settings.ai.provider) || "" },
              },
            };
          }
          ${messageScript}
        },
      },
    };
  })();
`;

/**
 * Replace the English stub catalogue with a real one from `_locales/`, so a
 * scenario proves the shipped translations render — not a hand-written map.
 */
const LOCALE_STUB = (messages, uiLanguage) => `
  (() => {
    const table = ${JSON.stringify(messages)};
    const substitute = (text, subs) => {
      const list = Array.isArray(subs) ? subs : subs === undefined ? [] : [subs];
      return String(text).replace(/\\$(?:([A-Z0-9_@]+)|(\\d+))\\$/gi, (whole, name, index) => {
        if (name) return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : whole;
        const value = list[Number(index) - 1];
        return value === undefined ? whole : String(value);
      });
    };
    if (window.browser && window.browser.i18n) {
      window.browser.i18n.getMessage = (key, subs) =>
        substitute(Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key, subs);
      window.browser.i18n.getUILanguage = () => ${JSON.stringify(uiLanguage)};
    }
  })();
`;

/** Flatten `_locales/<code>/messages.json` into {key: message}. */
function readLocaleMessages(code) {
  const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, "_locales", code, "messages.json"), "utf8"));
  const out = {};
  for (const [key, entry] of Object.entries(catalogue)) {
    if (entry && typeof entry.message === "string") out[key] = entry.message;
  }
  return out;
}

const DEFAULT_SEND = `
  await new Promise((resolve) => setTimeout(resolve, 0));
  window.__sent = message;
  return { translations: (message.texts || []).map((text) => "[译] " + text), engine: "google" };
`;

async function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/compose-page.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(COMPOSE_PAGE);
      return;
    }
    const file = path.join(DIST, url.pathname === "/" ? "options/options.html" : url.pathname);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      "content-type":
        ext === ".html" ? "text/html; charset=utf-8" : ext === ".css" ? "text/css" : "text/javascript",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

async function openOptions(browser, origin, sendScript = DEFAULT_SEND, locale = null, preload = null) {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  await context.addInitScript(WEBEXT_STUB(sendScript));
  // A stored settings blob, for scenarios that need a configured page.
  if (preload) await context.addInitScript(`localStorage.setItem("__dt_e2e_store", ${JSON.stringify(JSON.stringify(preload))})`);
  if (locale) await context.addInitScript(LOCALE_STUB(readLocaleMessages(locale), locale));
  await context.route("https://models.dev/api.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: FIXTURE })
  );
  const page = await context.newPage();
  const logs = [];
  page.on("pageerror", (error) => logs.push(error.message));
  await page.goto(`${origin}/options/options.html`);
  await page.waitForFunction(() => document.querySelectorAll("#provider option").length > 0);
  return { page, context, logs };
}

async function openCompose(browser, origin, sendScript = DEFAULT_SEND, locale = null) {
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  await context.addInitScript(WEBEXT_STUB(sendScript));
  if (locale) await context.addInitScript(LOCALE_STUB(readLocaleMessages(locale), locale));
  const page = await context.newPage();
  const logs = [];
  page.on("pageerror", (error) => logs.push(error.message));
  await page.goto(`${origin}/compose-page.html`);
  await page.waitForSelector("#dt-fab");
  return { page, context, logs };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const scenarios = [];
const scenario = (name, run) => scenarios.push({ name, run });

scenario("options-shape", async ({ browser, origin }) => {
  const { page, context } = await openOptions(browser, origin);
  const shape = await page.evaluate(() => {
    const provider = document.getElementById("provider");
    const options = Array.from(provider.options);
    const placeholder = options.find((option) => option.value === "");
    const real = options.filter((option) => option.value !== "");
    return {
      labels: real.map((option) => option.textContent.trim()),
      values: real.map((option) => option.value),
      disabled: real.some((option) => option.disabled),
      first: options[0] && { value: options[0].value, disabled: options[0].disabled, label: options[0].textContent.trim() },
      selected: provider.value,
      placeholderDisabledRows: options.filter((option) => option.disabled).length,
      placeholder: placeholder && { value: placeholder.value, label: placeholder.textContent.trim(), disabled: placeholder.disabled },
      modelDisabled: document.getElementById("modelSelect").disabled,
      modelValue: document.getElementById("modelSelect").value,
      modelLabel: (document.getElementById("modelSelect").options[0] || {}).textContent,
      reasoningDisabled: document.getElementById("reasoning").disabled,
      endpoint: document.getElementById("baseURL").value,
      endpointPlaceholder: document.getElementById("baseURL").placeholder,
      modelInputPlaceholder: document.getElementById("model").getAttribute("placeholder"),
      target: Array.from(document.getElementById("targetLang").options).map((option) => option.value),
      models: Array.from(document.getElementById("modelSelect").options).map((option) => option.value),
      reasoning: Array.from(document.getElementById("reasoning").options).map((option) => option.value),
    };
  });
  // One flat list: built-ins and catalogue merged, alphabetical by visible label,
  // no divider row anywhere.
  assert(!shape.disabled, "provider picker must not contain a disabled entry (divider)");
  assert(shape.values.includes("orcarouter"), "catalogue providers must be merged into the list");
  assert(shape.values.includes("openai"), "built-in providers must be in the list");
  assert(
    shape.labels.join("|") === [...shape.labels].sort((a, b) => a.localeCompare(b, "en")).join("|"),
    `provider list must be alphabetical: ${shape.labels.join(", ")}`
  );
  // R1: the language table, not ten hardcoded rows.
  assert(shape.target.length >= 38, `target picker has ${shape.target.length} options`);
  assert(shape.target.includes("ja") && shape.target.includes("pt-BR"), "target picker is missing languages");
  assert(shape.reasoning[0] === "lowest", `reasoning must start at lowest, got ${shape.reasoning[0]}`);
  assert(shape.reasoning[1] === "", "second option must be provider default");
  // SPEC 2.1: fresh install has no provider — a disabled placeholder leads the
  // list, the model picker says what to do, the endpoint shows only "https://".
  assert(shape.selected === "", `fresh install must start unconfigured, got "${shape.selected}"`);
  assert(
    JSON.stringify(shape.placeholder) === JSON.stringify({ value: "", label: "Select a provider", disabled: true }),
    `provider placeholder is wrong: ${JSON.stringify(shape.placeholder)}`
  );
  assert(shape.first && shape.first.value === "", "the placeholder must lead the provider list");
  assert(shape.placeholderDisabledRows === 1, `only the placeholder may be disabled, found ${shape.placeholderDisabledRows}`);
  assert(shape.modelDisabled, "model picker must be disabled while unconfigured");
  assert(shape.modelValue === "", `model must stay empty while unconfigured, got "${shape.modelValue}"`);
  assert(shape.modelLabel === "Select a provider first", `model placeholder: ${shape.modelLabel}`);
  assert(shape.reasoningDisabled, "reasoning picker must be disabled while unconfigured");
  assert(shape.endpoint === "", `endpoint must be empty while unconfigured, got "${shape.endpoint}"`);
  assert(shape.endpointPlaceholder === "https://", `endpoint placeholder must be https://, got "${shape.endpointPlaceholder}"`);
  // SPEC 2.1: no OpenAI leftovers hide behind the empty state (the custom-model
  // field used to suggest gpt-4o-mini even before a provider was chosen).
  assert(shape.modelInputPlaceholder === "", `custom model field must not prefill a model, got "${shape.modelInputPlaceholder}"`);
  await page.screenshot({ path: path.join(ARTIFACTS, "options-shape", "screenshot.png"), fullPage: true });
  await context.close();
});

scenario("options-save-and-restore", async ({ browser, origin }) => {
  // A configured install: provider stored, so the AI fields are live.
  const { page, context } = await openOptions(browser, origin, DEFAULT_SEND, null, {
    dtSettings: { targetLang: "en", engine: "google", ai: { provider: "openai", model: "gpt-4o-mini" } },
  });
  // The AI fields live inside a fieldset that only appears for the AI engine.
  await page.selectOption("#engine", "ai");
  await page.selectOption("#provider", "orcarouter");
  await page.selectOption("#modelSelect", "orcarouter/fusion-mini");
  await page.selectOption("#reasoning", "high");
  await page.selectOption("#targetLang", "ja");
  await page.click("#save");
  await page.waitForFunction(() => document.getElementById("status").textContent.length > 0);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("__dt_e2e_store") || "{}"));
  const saved = stored.dtSettings || {};
  assert(saved.engine === "ai", `engine not saved: ${saved.engine}`);
  assert(saved.targetLang === "ja", `target not saved: ${saved.targetLang}`);
  assert(saved.ai && saved.ai.provider === "orcarouter", `provider not saved: ${JSON.stringify(saved.ai)}`);
  assert(saved.ai.model === "orcarouter/fusion-mini", `model not saved: ${saved.ai.model}`);
  assert(saved.ai.reasoning === "high", `reasoning not saved: ${saved.ai.reasoning}`);

  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll("#provider option").length > 0);
  const restored = await page.evaluate(() => ({
    provider: document.getElementById("provider").value,
    model: document.getElementById("modelSelect").value,
    reasoning: document.getElementById("reasoning").value,
    target: document.getElementById("targetLang").value,
  }));
  assert(restored.provider === "orcarouter", `provider not restored: ${restored.provider}`);
  assert(restored.model === "orcarouter/fusion-mini", `model not restored: ${restored.model}`);
  assert(restored.reasoning === "high", `reasoning not restored: ${restored.reasoning}`);
  assert(restored.target === "ja", `target not restored: ${restored.target}`);
  await page.screenshot({ path: path.join(ARTIFACTS, "options-save-and-restore", "screenshot.png") });
  await context.close();
});

scenario("compose-provider-required", async ({ browser, origin }) => {
  // SPEC 2.1 on the shipped bundle: AI engine, no provider chosen. The primary
  // button is off and its tooltip is the German providerRequiredError; a click
  // must not reach the background. Google on the same page is never blocked.
  const de = readLocaleMessages("de");
  const empty = await openCompose(browser, origin, DEFAULT_SEND, "de");
  await empty.context.addInitScript(
    `localStorage.setItem("__dt_e2e_store", ${JSON.stringify(JSON.stringify({ dtSettings: { engine: "ai", ai: { provider: "", model: "" } } }))})`
  );
  await empty.page.reload();
  await empty.page.waitForSelector("#dt-fab");
  await empty.page.waitForFunction(() => document.getElementById("dt-fab").disabled, null, { timeout: 5000 });
  const blocked = await empty.page.evaluate(() => {
    const fab = document.getElementById("dt-fab");
    fab.click();
    return { disabled: fab.disabled, title: fab.getAttribute("title"), sent: window.__sent || null };
  });
  assert(blocked.disabled === true, "the translate button must be disabled while no AI provider is set");
  assert(blocked.title === de.providerRequiredError, `tooltip must be providerRequiredError, got "${blocked.title}"`);
  assert(blocked.sent === null || blocked.sent === undefined, `a disabled button must not translate: ${JSON.stringify(blocked.sent)}`);
  await empty.page.screenshot({ path: path.join(ARTIFACTS, "compose-provider-required", "screenshot.png") });
  await empty.context.close();

  const google = await openCompose(browser, origin, DEFAULT_SEND, "de");
  const live = await google.page.evaluate(() => ({
    disabled: document.getElementById("dt-fab").disabled,
    title: document.getElementById("dt-fab").getAttribute("title"),
  }));
  assert(live.disabled === false, "the Google engine must stay enabled with no AI provider");
  assert(!live.title, `the Google engine button must carry no tooltip, got "${live.title}"`);
  await google.context.close();
});

scenario("compose-translate", async ({ browser, origin }) => {
  const { page, context } = await openCompose(browser, origin);
  await page.click("#dt-fab");
  await page.waitForFunction(() => document.querySelectorAll(".dt-translation").length === 2, null, {
    timeout: 5000,
  });
  const state = await page.evaluate(() => ({
    translations: Array.from(document.querySelectorAll(".dt-translation")).map((node) => node.textContent),
    marked: document.querySelectorAll("[data-dt-translated]").length,
    label: document.getElementById("dt-fab").textContent,
    sent: window.__sent,
  }));
  assert(state.translations.every((text) => text.startsWith("[译]")), `bad translations: ${state.translations}`);
  assert(state.marked === 2, `expected 2 marked blocks, got ${state.marked}`);
  assert(state.sent.command === "dt-translate", `wrong command: ${state.sent && state.sent.command}`);
  assert(state.label.toLowerCase().includes("original") || state.label.includes("原文") || state.label.length > 0, "fab label did not change");
  await page.screenshot({ path: path.join(ARTIFACTS, "compose-translate", "screenshot.png") });
  await context.close();
});

scenario("compose-loading", async ({ browser, origin }) => {
  const slow = `
    window.__started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    window.__sent = message;
    return { translations: (message.texts || []).map((text) => "[译] " + text) };
  `;
  const { page, context } = await openCompose(browser, origin, slow);
  await page.click("#dt-fab");
  await page.waitForFunction(() => document.getElementById("dt-fab").classList.contains("busy"), null, {
    timeout: 1000,
  });
  await page.screenshot({ path: path.join(ARTIFACTS, "compose-loading", "screenshot-while-busy.png") });
  await page.waitForFunction(() => !document.getElementById("dt-fab").classList.contains("busy"), null, {
    timeout: 6000,
  });
  const state = await page.evaluate(() => ({
    busy: document.getElementById("dt-fab").classList.contains("busy"),
    disabled: document.getElementById("dt-fab").disabled,
    translations: document.querySelectorAll(".dt-translation").length,
  }));
  assert(!state.busy, "spinner stayed after the response");
  assert(!state.disabled, "button stayed disabled");
  assert(state.translations === 2, `expected 2 translations, got ${state.translations}`);
  await context.close();
});

scenario("compose-error", async ({ browser, origin }) => {
  const failing = `return { error: "mock 401" };`;
  const { page, context } = await openCompose(browser, origin, failing);
  await page.click("#dt-fab");
  await page.waitForFunction(() => /401/.test(document.getElementById("dt-fab").textContent), null, {
    timeout: 5000,
  });
  const state = await page.evaluate(() => ({
    label: document.getElementById("dt-fab").textContent,
    busy: document.getElementById("dt-fab").classList.contains("busy"),
    disabled: document.getElementById("dt-fab").disabled,
    translations: document.querySelectorAll(".dt-translation").length,
  }));
  assert(/401/.test(state.label), `error must surface 401, got ${state.label}`);
  assert(!state.busy, "spinner must be cleared on failure");
  assert(!state.disabled, "button must be usable again");
  assert(state.translations === 0, "a failed translation must not insert blocks");
  await page.screenshot({ path: path.join(ARTIFACTS, "compose-error", "screenshot.png") });
  await context.close();
});

scenario("options-error-free-boot", async ({ browser, origin }) => {
  // A regression guard for the options page: no uncaught errors and no missing
  // locale keys rendered as raw ids.
  const { page, context, logs } = await openOptions(browser, origin);
  const labels = await page.evaluate(() => ({
    provider: document.querySelector('[data-i18n="optionProvider"]').textContent,
    disabled: Array.from(document.querySelectorAll("#provider option")).filter((option) => option.disabled && option.value !== "").length,
    reasoning: document.querySelector('[data-i18n="optionReasoning"]').textContent,
  }));
  assert(logs.length === 0, `page errors: ${logs.join(" | ")}`);
  assert(!/^[a-z]+\.[a-zA-Z]+$/.test(labels.provider), `i18n leak: ${labels.provider}`);
  assert(labels.disabled === 0, `provider list must have no divider row, found ${labels.disabled}`);
  await page.screenshot({ path: path.join(ARTIFACTS, "options-error-free-boot", "screenshot.png") });
  await context.close();
});

scenario("i18n-locale", async ({ browser, origin }) => {
  // The shipped German catalogue must drive every visible label — no raw keys,
  // no English leftovers, and the option pages must agree with compose.
  const de = readLocaleMessages("de");
  const { page, context, logs } = await openOptions(browser, origin, DEFAULT_SEND, "de");
  const options = await page.evaluate(() => ({
    provider: document.querySelector('[data-i18n="optionProvider"]').textContent.trim(),
    target: document.querySelector('[data-i18n="optionTargetLang"]').textContent.trim(),
    reasoning: document.querySelector('[data-i18n="optionReasoning"]').textContent.trim(),
    save: document.getElementById("save").textContent.trim(),
    leaks: Array.from(document.querySelectorAll("[data-i18n]"))
      .filter((node) => {
        const key = node.getAttribute("data-i18n");
        const text = (node.textContent || "").trim();
        return !text || text === key;
      })
      .map((node) => node.getAttribute("data-i18n")),
  }));
  assert(logs.length === 0, `page errors: ${logs.join(" | ")}`);
  assert(options.leaks.length === 0, `untranslated labels: ${options.leaks.join(", ")}`);
  assert(options.provider === de.optionProvider, `provider label must be German, got "${options.provider}"`);
  assert(options.target === de.optionTargetLang, `target label must be German, got "${options.target}"`);
  assert(options.reasoning === de.optionReasoning, `reasoning label must be German, got "${options.reasoning}"`);
  assert(options.save === de.optionSave, `save button must be German, got "${options.save}"`);
  await page.screenshot({ path: path.join(ARTIFACTS, "i18n-locale", "options-de.png") });
  await context.close();

  const compose = await openCompose(browser, origin, DEFAULT_SEND, "de");
  const fab = await compose.page.evaluate(() => document.getElementById("dt-fab").textContent.trim());
  assert(fab === de.btnComposeTranslate, `compose button must be German, got "${fab}"`);
  await compose.page.screenshot({ path: path.join(ARTIFACTS, "i18n-locale", "compose-de.png") });
  await compose.context.close();
});

async function main() {
  fs.rmSync(ARTIFACTS, { recursive: true, force: true });
  for (const entry of scenarios) fs.mkdirSync(path.join(ARTIFACTS, entry.name), { recursive: true });

  const origin = await startServer();
  const browser = await chromium.launch({ headless: true });
  const failures = [];

  for (const entry of scenarios) {
    const started = Date.now();
    process.stdout.write(`▶ ${entry.name} … `);
    try {
      await entry.run({ browser, origin: origin.origin });
      console.log(`ok (${Date.now() - started} ms)`);
    } catch (error) {
      failures.push(entry.name);
      console.log(`FAILED\n  ${error && error.stack ? error.stack.split("\n").slice(0, 4).join("\n  ") : error}`);
      fs.writeFileSync(
        path.join(ARTIFACTS, entry.name, "error.txt"),
        String(error && error.stack ? error.stack : error)
      );
    }
  }

  await browser.close();
  await origin.close();

  if (failures.length) {
    console.error(`\n${failures.length}/${scenarios.length} scenarios failed: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`\n${scenarios.length}/${scenarios.length} scenarios passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
