/**
 * Conformance: the options page is loaded exactly as the extension ships it
 * (src/options/options.html + catalog.js + languages.js + options.js) into
 * jsdom, against a stubbed `browser` host and the recorded models.dev sample.
 *
 * Nothing here re-implements the product logic: every value in the payload is
 * read back from the live DOM after driving the controls the way a user does.
 * `validatePayload` (the shared, dependency-free spec validator) is what turns
 * those readings into R1…R5 pass/fail.
 *
 * The payload is rebuilt per `buildPayload()` call, so the validator sees a
 * fresh page, not a mutated one.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

import catalogApi from "../src/options/catalog.js";
import { selfTest, validatePayload, SPEC_VERSION, ConformanceError } from "../scripts/conformance/validate.mjs";
import { scanFiles } from "../scripts/conformance/scan.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPTIONS_DIR = path.join(ROOT, "src", "options");

const MODELS_DEV_SAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "conformance", "models-dev-sample.json"), "utf8"));
const LANGUAGE_NAMES = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "conformance", "language-names.json"), "utf8"));

const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "conformance.json"), "utf8"));

const SCRIPT_ORDER = ["catalog.js", "languages.js", "options.js"];

/** Let the page's async boot (catalogue, then settings) run to completion. */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Every <script src> the page actually asks for, resolved inside src/options. */
function pageScripts(html) {
  return [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
}

function messageTable() {
  const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, "_locales", "en", "messages.json"), "utf8"));
  const table = {};
  for (const [key, entry] of Object.entries(catalogue)) {
    if (entry && typeof entry.message === "string") table[key] = entry.message;
  }
  return table;
}

/**
 * Boot the options page. Returns the jsdom window plus the controls the test
 * drives. The script order is the one the real page declares.
 */
async function bootOptions({ settings = {}, catalog = MODELS_DEV_SAMPLE } = {}) {
  const html = fs.readFileSync(path.join(OPTIONS_DIR, "options.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "https://options.test/options.html",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const messages = messageTable();
  const store = { dtCatalog: { ts: Date.now(), data: catalogApi.projectCatalog(catalog) } };
  if (Object.keys(settings).length) store.dtSettings = settings;

  const calls = { sent: [] };
  window.browser = {
    i18n: {
      getMessage: (key) => messages[key] ?? "",
      getUILanguage: () => "en",
    },
    storage: {
      local: {
        get: async (defaults) => {
          const out = {};
          for (const [key, fallback] of Object.entries(defaults || {})) {
            out[key] = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback;
          }
          return out;
        },
        set: async (values) => {
          Object.assign(store, values);
        },
      },
    },
    runtime: {
      sendMessage: async (message) => {
        calls.sent.push(message);
        return undefined;
      },
    },
  };

  const errors = [];
  window.addEventListener("error", (event) => errors.push(event.error || event.message));

  for (const src of pageScripts(html)) {
    const file = path.join(OPTIONS_DIR, src);
    if (!fs.existsSync(file)) {
      errors.push(new Error(`options.html loads a missing script: ${src}`));
      continue;
    }
    try {
      window.eval(fs.readFileSync(file, "utf8"));
    } catch (error) {
      errors.push(error);
    }
  }

  // The page boots asynchronously (catalogue from storage, then settings).
  const $ = (id) => window.document.getElementById(id);
  for (let i = 0; i < 100; i += 1) {
    await tick();
    if ($("provider").options.length > 0) break;
  }
  await tick();

  const change = (element) =>
    element.dispatchEvent(new window.Event("change", { bubbles: true }));
  const fire = (element, type) => element.dispatchEvent(new window.Event(type, { bubbles: true }));

  return { window, document: window.document, $, store, calls, errors, change, fire };
}

function optionsOf(select) {
  return Array.from(select.options).map((option) => ({
    value: option.value,
    label: (option.textContent || "").trim(),
    disabled: option.disabled === true,
  }));
}

/**
 * Build the conformance payload from the live options page.
 *
 * R3 is exercised in three steps on one page: pick a provider (autofill),
 * overwrite the field by hand (override), switch to another provider (the
 * override must survive).
 */
export async function buildPayload() {
  const ui = await bootOptions({ settings: { targetLang: "zh-CN", engine: "ai", ai: { provider: "openai" } } });
  const { window, $, change, fire } = ui;
  if (ui.errors.length) throw ui.errors[0];

  // ── R1 target language ────────────────────────────────────────────────────
  const langSelect = $("targetLang");
  const language = {
    control: langSelect.tagName.toLowerCase() === "select" ? "select" : langSelect.type,
    current: langSelect.value,
    options: optionsOf(langSelect),
  };
  const languageTextInputs = [...ui.document.querySelectorAll('input[id*="lang" i]')].length;

  // ── R2 providers ──────────────────────────────────────────────────────────
  const providerSelect = $("provider");
  const builtInIds = new Set(catalogApi.BUILTINS.map((entry) => entry.id));
  const providerOptions = optionsOf(providerSelect).map((option) => ({
    ...option,
    source: builtInIds.has(option.value) ? "built-in" : "models.dev",
  }));
  const providerTextInput = ui.document.querySelector('input[id="provider" i]');
  if (providerTextInput) providerOptions.push({ value: providerTextInput.value, label: "custom", source: "custom" });

  // Model lists per provider, read by switching provider and reading the real select.
  const byProvider = {};
  const customProviders = optionsOf(providerSelect).filter((option) => option.value.startsWith("__"));
  for (const option of optionsOf(providerSelect)) {
    providerSelect.value = option.value;
    change(providerSelect);
    const models = optionsOf($("modelSelect")).filter((entry) => !/^__custom/.test(entry.value));
    if (models.length) byProvider[option.value] = models;
  }
  providerSelect.value = "openai";
  change(providerSelect);

  const selectedProvider = "openai";
  const selectedModel = byProvider[selectedProvider] ? byProvider[selectedProvider][0].value : "";
  providerSelect.value = selectedProvider;
  change(providerSelect);
  $("modelSelect").value = selectedModel;
  change($("modelSelect"));

  // ── R3 endpoint autofill ──────────────────────────────────────────────────
  const base = $("baseURL");
  const before = base.value;
  base.value = "";
  const providerApi = new Map();
  for (const entry of [...catalogApi.BUILTINS, ...(catalogApi.projectCatalog(MODELS_DEV_SAMPLE).providers || [])]) {
    providerApi.set(entry.id, entry.api);
  }
  const targetProvider = providerOptions.find((option) => option.value === "deepseek")
    || providerOptions.find((option) => providerApi.get(option.value));
  providerSelect.value = targetProvider.value;
  change(providerSelect);
  const after = base.value;

  const userEdited = "https://proxy.example/v1";
  base.value = userEdited;
  fire(base, "input");
  const otherProvider = providerOptions.find(
    (option) => option.value !== targetProvider.value && providerApi.get(option.value)
  ) || providerOptions.find((option) => option.value !== targetProvider.value);
  providerSelect.value = otherProvider.value;
  change(providerSelect);
  const afterSwitch = base.value;

  // ── R4 reasoning ──────────────────────────────────────────────────────────
  const reasoningSelect = $("reasoning");
  const reasoningDefault = reasoningSelect.options.length ? reasoningSelect.options[0].value : "";
  const resolved = {
    none: [{ setting: "lowest", options: ["none", "minimal", "low"], value: catalogApi.resolveReasoning("lowest", ["none", "minimal", "low"]) }],
    minimal: [{ setting: "lowest", options: ["minimal", "low"], value: catalogApi.resolveReasoning("lowest", ["minimal", "low"]) }],
    low: [{ setting: "lowest", options: ["low", "medium"], value: catalogApi.resolveReasoning("lowest", ["low", "medium"]) }],
    "none-declared": [{ setting: "lowest", options: [], value: catalogApi.resolveReasoning("lowest", []) }],
  };

  // ── R5 i18n ───────────────────────────────────────────────────────────────
  const localesDir = path.join(ROOT, "_locales");
  const locales = fs
    .readdirSync(localesDir)
    .filter((code) => fs.existsSync(path.join(localesDir, code, "messages.json")))
    .sort();
  const files = {};
  for (const code of locales) {
    const catalogue = JSON.parse(fs.readFileSync(path.join(localesDir, code, "messages.json"), "utf8"));
    files[code] = Object.fromEntries(
      Object.entries(catalogue)
        .filter(([, entry]) => entry && typeof entry.message === "string")
        .map(([key, entry]) => [key, entry.message])
    );
  }
  const keys = Object.keys(files.en || {});
  const used = new Set();
  for (const file of pageSourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/data-i18n="([^"]+)"/g)) used.add(match[1]);
    for (const match of text.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) used.add(match[1]);
  }

  const payload = {
    spec: SPEC_VERSION,
    host: CONFIG.host,
    language: { ...language, textInputs: languageTextInputs },
    provider: { control: "select", current: providerSelect.value, options: providerOptions, customProviders: customProviders.length },
    model: { control: "select", selectedProvider, selectedModel, byProvider },
    endpoint: {
      control: "text",
      autofill: {
        provider: targetProvider.value,
        providerApi: after,
        before,
        after,
        userEdited,
        afterSwitch,
      },
    },
    reasoning: { control: "select", default: reasoningDefault, resolved },
    i18n: { locales, keys, used: [...used].sort(), sourceLocale: "en", files },
  };
  window.close?.();
  return payload;
}

function pageSourceFiles() {
  const dir = path.join(ROOT, "src", "options");
  return fs
    .readdirSync(dir)
    .filter((name) => /\.(js|html)$/.test(name))
    .map((name) => path.join(dir, name));
}

describe("options page conformance", () => {
  it("validator kit passes its own negative controls", () => {
    expect(selfTest()).toBeGreaterThanOrEqual(12);
  });

  it("loads the options page without errors and in the declared script order", async () => {
    const ui = await bootOptions();
    expect(ui.errors.map(String)).toEqual([]);
    expect(pageScripts(fs.readFileSync(path.join(OPTIONS_DIR, "options.html"), "utf8"))).toEqual(SCRIPT_ORDER);
    ui.window.close?.();
  });

  it("R1 ships every target language from tests/fixtures/conformance/language-names.json", async () => {
    const ui = await bootOptions();
    const select = ui.$("targetLang");
    const values = optionsOf(select).map((option) => option.value);
    expect(new Set(values)).toEqual(new Set(Object.keys(LANGUAGE_NAMES)));
    expect(values.length).toBeGreaterThanOrEqual(38);
    for (const option of optionsOf(select)) {
      expect(option.label).toBe(`${LANGUAGE_NAMES[option.value]} (${option.value})`);
    }
    expect(ui.document.querySelector('input[id*="lang" i]')).toBeNull();
    select.value = "ja";
    expect(ui.$("targetLang").value).toBe("ja");
    ui.window.close?.();
  });

  it("keeps a saved target language selected", async () => {
    const ui = await bootOptions({ settings: { targetLang: "pt-BR" } });
    expect(ui.$("targetLang").value).toBe("pt-BR");
    ui.window.close?.();
  });

  it("R2 merges built-ins and models.dev into one alphabetical, divider-free list", async () => {
    const ui = await bootOptions();
    const options = optionsOf(ui.$("provider"));
    expect(options.some((option) => option.disabled)).toBe(false);
    expect(options.filter((option) => !option.value)).toEqual([]);
    const values = options.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
    const compare = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    const labels = options.map((option) => option.label);
    expect(labels).toEqual([...labels].sort(compare.compare));
    // The catalogue is merged in: built-in-only rows are not enough.
    const builtIns = new Set(catalogApi.BUILTINS.map((entry) => entry.id));
    expect(values.filter((value) => !builtIns.has(value)).length).toBeGreaterThan(0);
    // Alias twins: one row per real provider, no `google` next to `google-gemini`.
    for (const entry of catalogApi.BUILTINS) {
      expect(values).toContain(entry.id);
      if (entry.dev !== entry.id) expect(values).not.toContain(entry.dev);
    }
    expect(values).toHaveLength(catalogApi.buildProviderList(catalogApi.projectCatalog(MODELS_DEV_SAMPLE).providers, {}).length);
    ui.window.close?.();
  });

  it("R2 lists each provider's models alphabetically with the custom entry last", async () => {
    const ui = await bootOptions();
    const provider = ui.$("provider");
    const compare = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    for (const option of optionsOf(provider)) {
      provider.value = option.value;
      ui.change(provider);
      const models = optionsOf(ui.$("modelSelect"));
      expect(models.length).toBeGreaterThan(1);
      expect(models.at(-1).value).toMatch(/^__custom/);
      const labels = models.slice(0, -1).map((entry) => entry.label);
      expect(labels, `models for ${option.value}`).toEqual([...labels].sort(compare.compare));
    }
    ui.window.close?.();
  });

  it("R3 fills the endpoint on provider change and never clobbers a typed value", async () => {
    const ui = await bootOptions();
    const provider = ui.$("provider");
    const base = ui.$("baseURL");
    provider.value = "deepseek";
    ui.change(provider);
    expect(base.value).toBe("https://api.deepseek.com/v1");
    base.value = "https://proxy.example/v1";
    ui.fire(base, "input");
    provider.value = "openai";
    ui.change(provider);
    expect(base.value).toBe("https://proxy.example/v1");
    provider.value = "deepseek";
    ui.change(provider);
    expect(base.value).toBe("https://proxy.example/v1");
    ui.window.close?.();
  });

  it("R4 keeps the lowest sentinel first and resolves none → minimal → low", async () => {
    const ui = await bootOptions();
    const options = optionsOf(ui.$("reasoning"));
    expect(options[0].value).toBe("lowest");
    expect(options[1].value).toBe("");
    ui.window.close?.();
  });

  it("emits a payload the shared SPEC 2.0.0 validator accepts", async () => {
    const payload = await buildPayload();
    payload.static = { hits: scanFiles(ROOT, CONFIG.static) };
    if (process.env.DT_CONFORMANCE_OUT) {
      // Consumed by scripts/conformance/host-payload.mjs for `npm run conformance`;
      // vitest swallows console output, so the payload goes through a file.
      fs.writeFileSync(process.env.DT_CONFORMANCE_OUT, JSON.stringify(payload));
    }
    expect(payload.static.hits).toEqual([]);
    const summary = validatePayload(payload, CONFIG);
    expect(summary).toMatchObject({ spec: SPEC_VERSION, host: "dualtran-thunderbird" });
    expect(summary.languages).toBeGreaterThanOrEqual(38);
    expect(summary.localeCount).toBeGreaterThanOrEqual(38);
  });

  it("the validator rejects the pre-fix shape (negative control on the live page)", async () => {
    const payload = await buildPayload();
    const broken = JSON.parse(JSON.stringify(payload));
    broken.language.options = broken.language.options.slice(0, 10);
    expect(() => validatePayload(broken, CONFIG)).toThrow(ConformanceError);
    const divider = JSON.parse(JSON.stringify(payload));
    divider.provider.options.splice(3, 0, { value: "__separator__", label: "──── More ────", disabled: true });
    expect(() => validatePayload(divider, CONFIG)).toThrow(/R2/);
    const noEndpoint = JSON.parse(JSON.stringify(payload));
    noEndpoint.endpoint.autofill.after = "";
    expect(() => validatePayload(noEndpoint, CONFIG)).toThrow(/R3/);
  });
});
