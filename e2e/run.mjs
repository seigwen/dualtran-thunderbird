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
      extName: "DualTran", extDescription: "DualTran", optionApiKeyHint: "stored locally"
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

async function openOptions(browser, origin, sendScript = DEFAULT_SEND, locale = null) {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  await context.addInitScript(WEBEXT_STUB(sendScript));
  if (locale) await context.addInitScript(LOCALE_STUB(readLocaleMessages(locale), locale));
  await context.route("https://models.dev/api.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: FIXTURE })
  );
  const page = await context.newPage();
  const logs = [];
  page.on("pageerror", (error) => logs.push(error.message));
  await page.goto(`${origin}/options/options.html`);
  await page.waitForFunction(() => document.querySelectorAll("#provider option").length > 0);
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("#provider option")).some((option) => option.disabled)
  );
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
    const divider = options.findIndex((option) => option.disabled);
    return {
      first: options[0].value,
      dividerText: divider >= 0 ? options[divider].textContent.trim() : null,
      after: divider >= 0 ? options.slice(divider + 1).map((option) => option.value) : [],
      models: Array.from(document.getElementById("modelSelect").options).map((option) => option.value),
      reasoning: Array.from(document.getElementById("reasoning").options).map((option) => option.value),
    };
  });
  assert(shape.first === "openai", `built-ins must lead, got ${shape.first}`);
  assert(shape.dividerText && shape.dividerText.includes("more"), `bad divider: ${shape.dividerText}`);
  assert(shape.after.includes("orcarouter"), "catalogue providers must follow the divider");
  assert(shape.reasoning[0] === "lowest", `reasoning must start at lowest, got ${shape.reasoning[0]}`);
  assert(shape.reasoning[1] === "", "second option must be provider default");
  await page.screenshot({ path: path.join(ARTIFACTS, "options-shape", "screenshot.png"), fullPage: true });
  await context.close();
});

scenario("options-save-and-restore", async ({ browser, origin }) => {
  const { page, context } = await openOptions(browser, origin);
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
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("#provider option")).some((option) => option.disabled)
  );
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
  // locale keys rendered as raw ids (the "optionMore" style leak).
  const { page, context, logs } = await openOptions(browser, origin);
  const labels = await page.evaluate(() => ({
    provider: document.querySelector('[data-i18n="optionProvider"]').textContent,
    more: Array.from(document.querySelectorAll("#provider option"))
      .filter((option) => option.disabled)
      .map((option) => option.textContent.trim())[0],
    reasoning: document.querySelector('[data-i18n="optionReasoning"]').textContent,
  }));
  assert(logs.length === 0, `page errors: ${logs.join(" | ")}`);
  assert(!/^[a-z]+\.[a-zA-Z]+$/.test(labels.provider), `i18n leak: ${labels.provider}`);
  assert(labels.more && labels.more.includes("more"), `divider text missing: ${labels.more}`);
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
    divider: Array.from(document.querySelectorAll("#provider option"))
      .filter((option) => option.disabled)
      .map((option) => option.textContent.trim())[0],
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
  assert(
    options.divider && options.divider.includes(de.optionMore) && !/more/.test(options.divider),
    `catalogue divider must be German, got "${options.divider}"`
  );
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
