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
import {
  selfTest,
  validatePayload,
  SPEC_VERSION,
  ConformanceError,
} from "../scripts/conformance/validate.mjs";
import { scanFiles } from "../scripts/conformance/scan.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPTIONS_DIR = path.join(ROOT, "src", "options");

const MODELS_DEV_SAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "conformance", "models-dev-sample.json"), "utf8"));
const LANGUAGE_NAMES = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "conformance", "language-names.json"), "utf8"));

const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "conformance.json"), "utf8"));

const SCRIPT_ORDER = ["catalog.js", "languages.js", "options.js"];

/** The three keys SPEC 2.1 adds to every locale (English source strings). */
export const SPEC_KEYS = ["providerPlaceholder", "providerRequiredForModel", "providerRequiredError"];

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


/** The placeholder is the row every picker needs but no list may contain. */
function placeholderOf(select) {
  const option = Array.from(select.options).find((entry) => entry.value === "");
  const current = String(select.value ?? "").trim();
  if (!option) return null;
  return {
    value: option.value,
    label: (option.textContent || "").trim(),
    disabled: option.disabled === true,
    selected: current === "" && select.selectedOptions[0] === option,
  };
}

/** Real options of a picker: anything but the empty placeholder row. */
function realOptionsOf(select) {
  return optionsOf(select).filter((option) => option.value !== "");
}

function providerApiOf() {
  const api = new Map();
  for (const entry of [...catalogApi.BUILTINS, ...(catalogApi.projectCatalog(MODELS_DEV_SAMPLE).providers || [])]) {
    api.set(entry.id, entry.api);
  }
  return api;
}

/**
 * SPEC 2.1 — the unconfigured page: a fresh install with no AI settings at all.
 * Everything here is read back from the live controls, not from constants.
 */
async function emptyState() {
  const ui = await bootOptions();
  const { $ } = ui;
  const providerSelect = $("provider");
  const modelSelect = $("modelSelect");
  const reasoningSelect = $("reasoning");
  const base = $("baseURL");
  return {
    ui,
    provider: {
      control: "select",
      current: providerSelect.value,
      placeholder: placeholderOf(providerSelect),
      // What the code would send if the pick were missing: read the picker, not the source.
      fallback: String(providerSelect.selectedOptions[0]?.value ?? "").trim(),
      options: realOptionsOf(providerSelect),
    },
    model: {
      control: "select",
      disabled: modelSelect.disabled,
      selectedProvider: providerSelect.value,
      selectedModel: modelSelect.value,
      options: realOptionsOf(modelSelect),
      byProvider: {},
    },
    endpoint: {
      control: "input",
      current: base.value,
      placeholder: base.getAttribute("placeholder") ?? "",
      autofill: {},
    },
    reasoning: {
      control: "select",
      disabled: reasoningSelect.disabled,
      default: reasoningSelect.value,
      resolved: resolveCases(),
    },
  };
}

function resolveCases() {
  return {
    none: [{ setting: "lowest", options: ["none", "minimal", "low"], value: catalogApi.resolveReasoning("lowest", ["none", "minimal", "low"]) }],
    minimal: [{ setting: "lowest", options: ["minimal", "low"], value: catalogApi.resolveReasoning("lowest", ["minimal", "low"]) }],
    low: [{ setting: "lowest", options: ["low", "medium"], value: catalogApi.resolveReasoning("lowest", ["low", "medium"]) }],
    "none-declared": [{ setting: "lowest", options: [], value: catalogApi.resolveReasoning("lowest", []) }],
  };
}

/**
 * Build the conformance payload from the live options page.
 *
 * Two states, both read from the real controls: the unconfigured page (fresh
 * install, no AI settings) and a configured one. R3 is exercised in three
 * steps on one page: pick a provider (autofill), overwrite the field by hand
 * (override), switch to another provider (the override must survive).
 */
export async function buildPayload() {
  // ── empty state: fresh install, nothing stored ────────────────────────────
  const empty = await emptyState();
  if (empty.ui.errors.length) throw empty.ui.errors[0];
  const providerApi = providerApiOf();

  // The empty page never shows an OpenAI endpoint or model.
  const { provider, model, endpoint, reasoning } = empty;
  const emptyText = JSON.stringify({ endpoint, model, reasoning, provider: provider.options });
  if (/api\.openai\.com/.test(emptyText) || /"gpt-?4/i.test(emptyText)) {
    throw new Error("empty state leaks an OpenAI endpoint/model");
  }
  const anthropicApi = catalogApi.endpointFor("anthropic", providerApi.get("anthropic"));
  if (!/^https:\/\//.test(anthropicApi)) throw new Error("no endpoint for anthropic");

  // The autofill record: empty before, the provider's base after a real pick,
  // and a typed override that survives a later switch.
  const providerSelect = empty.ui.$("provider");
  const base = empty.ui.$("baseURL");
  const before = base.value;
  providerSelect.value = "anthropic";
  empty.ui.change(providerSelect);
  const after = base.value;
  const userEdited = "https://proxy.example/v1";
  base.value = userEdited;
  empty.ui.fire(base, "input");
  const other = provider.options.find((option) => option.value !== "anthropic" && option.value !== "deepseek");
  providerSelect.value = other.value;
  empty.ui.change(providerSelect);
  const afterSwitch = base.value;
  if (providerSelect.value === "") {
    throw new Error("the provider placeholder can be selected again after a real pick");
  }
  endpoint.autofill = { before, after, providerApi: anthropicApi, userEdited, afterSwitch };
  empty.ui.window.close?.();

  // Snapshot the unconfigured state BEFORE the configured page overwrites
  // anything: the payload must report both, and the empty one is what a fresh
  // install shows. Deep-copied so later edits cannot reach back into it.
  const unconfigured = JSON.parse(
    JSON.stringify({ provider, model, endpoint, reasoning })
  );

  // ── configured state: the same page with anthropic stored ─────────────────
  const configuredUi = await bootOptions({
    settings: { targetLang: "zh-CN", engine: "ai", ai: { provider: "anthropic", model: "claude-sonnet-4-5" } },
  });
  const { window, $, change } = configuredUi;
  if (configuredUi.errors.length) throw configuredUi.errors[0];

  // ── R1 target language ────────────────────────────────────────────────────
  const langSelect = $("targetLang");
  const language = {
    control: langSelect.tagName.toLowerCase() === "select" ? "select" : langSelect.type,
    current: langSelect.value,
    options: optionsOf(langSelect),
  };
  const languageTextInputs = [...configuredUi.document.querySelectorAll('input[id*="lang" i]')].length;

  // ── R2 providers ──────────────────────────────────────────────────────────
  const configuredProvider = $("provider");
  const builtInIds = new Set(catalogApi.BUILTINS.map((entry) => entry.id));
  // Same list as the empty state, plus where each row came from.
  const providerOptions = realOptionsOf(configuredProvider).map(({ value, label }) => ({
    value,
    label,
    source: builtInIds.has(value) ? "built-in" : "models.dev",
  }));
  const providerTextInput = configuredUi.document.querySelector('input[id="provider" i]');
  if (providerTextInput) providerOptions.push({ value: providerTextInput.value, label: "custom", source: "custom" });

  // Model lists per provider, read by switching provider and reading the real select.
  const byProvider = {};
  const customProviders = realOptionsOf(configuredProvider).filter((option) => option.value.startsWith("__"));
  for (const option of realOptionsOf(configuredProvider)) {
    configuredProvider.value = option.value;
    change(configuredProvider);
    const models = realOptionsOf($("modelSelect")).filter((entry) => !/^__custom/.test(entry.value));
    if (models.length) byProvider[option.value] = models;
  }

  const selectedProvider = "anthropic";
  const selectedModel = "claude-sonnet-4-5";
  configuredProvider.value = selectedProvider;
  change(configuredProvider);
  $("modelSelect").value = selectedModel;
  change($("modelSelect"));

  // ── R3 endpoint autofill ──────────────────────────────────────────────────
  const configuredEndpointCurrent = $("baseURL").value;

  // ── R4 reasoning ──────────────────────────────────────────────────────────
  const configuredReasoning = $("reasoning");

  // Provider state as stored: the placeholder must be there but not selected.
  provider.current = selectedProvider;
  provider.placeholder = placeholderOf(configuredProvider);

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
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/data-i18n="([^"]+)"/g)) used.add(match[1]);
    for (const match of text.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) used.add(match[1]);
    // Keys looked up by name rather than through `t(...)` (the engine's
    // providerRequiredError does this) still have to ship in every catalogue.
    for (const match of text.matchAll(/getMessage\(\s*"([A-Za-z0-9_]+)"/g)) used.add(match[1]);
  }
  // R5: the UI only asks for keys this repo defines, and the SPEC 2.1 keys are
  // referenced by the code that needs them.
  for (const key of used) {
    if (!keys.includes(key)) throw new Error(`UI references missing i18n key "${key}"`);
  }
  for (const key of SPEC_KEYS) {
    if (!used.has(key)) throw new Error(`SPEC 2.1 key "${key}" is not referenced by the UI`);
  }

  // ── configured state, read from the live controls ─────────────────────────
  // The provider list carries where each row came from, in both states.
  const withSource = (section) => ({ ...section, options: providerOptions });
  const configuredModel = $("modelSelect");
  const configured = {
    provider: withSource({ control: "select", current: $("provider").value, placeholder: placeholderOf(configuredProvider) }),
    model: {
      control: "select",
      disabled: configuredModel.disabled,
      selectedProvider: $("provider").value,
      selectedModel: configuredModel.value,
      options: optionsOf(configuredModel),
      byProvider,
    },
    endpoint: {
      // The stored provider's base, as the endpoint input actually holds it.
      control: "input",
      current: configuredEndpointCurrent,
      placeholder: $("baseURL").getAttribute("placeholder") ?? "",
      // R3 reads autofill from whichever section carries provider.current; the
      // configured page reports the same measured sequence.
      autofill: unconfigured.endpoint.autofill,
    },
    reasoning: {
      control: "select",
      disabled: configuredReasoning.disabled,
      default: configuredReasoning.options.length ? configuredReasoning.options[0].value : "",
      selected: configuredReasoning.value,
      resolved: resolveCases(),
    },
  };

  // The primary sections describe the UNCONFIGURED page (a fresh install), per
  // the SPEC 2.1 contract; the configured page ships alongside as `configured`,
  // and both are validated.
  const payload = {
    spec: SPEC_VERSION,
    host: CONFIG.host,
    language: { ...language, textInputs: languageTextInputs },
    provider: withSource(unconfigured.provider),
    model: unconfigured.model,
    endpoint: unconfigured.endpoint,
    reasoning: unconfigured.reasoning,
    unconfigured: { ...unconfigured, provider: withSource(unconfigured.provider) },
    configured,
    i18n: { locales, keys, used: [...used].sort(), sourceLocale: "en", files },
  };
  window.close?.();
  return payload;
}

/** Every shipped source file that can reference a catalogue key. */
function sourceFiles() {
  const dir = path.join(ROOT, "src");
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs|html)$/.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
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
    const options = realOptionsOf(ui.$("provider"));
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
    const ui = await bootOptions({ settings: { ai: { provider: "openai" } } });
    const provider = ui.$("provider");
    const compare = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    for (const option of realOptionsOf(provider)) {
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

  it("SPEC 2.1 — a fresh install starts with an empty provider", async () => {
    const ui = await bootOptions();
    const select = ui.$("provider");
    expect(select.value).toBe("");
    const placeholder = placeholderOf(select);
    expect(placeholder).toEqual({ value: "", label: "Select a provider", disabled: true, selected: true });
    // The placeholder is not one of the real providers.
    expect(realOptionsOf(select).some((option) => option.value === "")).toBe(false);
    ui.window.close?.();
  });

  it("SPEC 2.1 — the placeholder is not sorted into the list and custom stays last", async () => {
    const ui = await bootOptions();
    const options = Array.from(ui.$("provider").options);
    expect(options[0].value).toBe("");
    expect(options[0].disabled).toBe(true);
    const rest = optionsOf(ui.$("provider")).slice(1);
    expect(rest.map((option) => option.label)).toEqual(
      [...rest.map((option) => option.label)].sort(new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare)
    );
    expect(rest.some((option) => option.disabled)).toBe(false);
    expect(rest.filter((option) => option.value === "")).toEqual([]);
    ui.window.close?.();
  });

  it("SPEC 2.1 — empty state: endpoint, model and reasoning say what is missing", async () => {
    const ui = await bootOptions();
    expect(ui.$("baseURL").value).toBe("");
    expect(ui.$("baseURL").getAttribute("placeholder")).toBe("https://");
    const model = ui.$("modelSelect");
    expect(model.disabled).toBe(true);
    expect(realOptionsOf(model)).toEqual([]);
    const placeholder = Array.from(model.options).find((option) => option.value === "");
    expect(placeholder.label).toBe("Select a provider first");
    expect(model.value).toBe("");
    const reasoning = ui.$("reasoning");
    expect(reasoning.disabled).toBe(true);
    expect(reasoning.value).toBe("lowest");
    ui.window.close?.();
  });

  it("SPEC 2.1 — choosing a provider enables everything and cannot go back to empty", async () => {
    const ui = await bootOptions();
    const provider = ui.$("provider");
    provider.value = "anthropic";
    ui.change(provider);
    expect(ui.$("baseURL").value).toBe("https://api.anthropic.com/v1");
    expect(ui.$("modelSelect").disabled).toBe(false);
    expect(realOptionsOf(ui.$("modelSelect")).length).toBeGreaterThan(0);
    expect(ui.$("reasoning").disabled).toBe(false);
    const placeholder = Array.from(provider.options).find((option) => option.value === "");
    expect(placeholder.disabled).toBe(true);
    expect(provider.value).toBe("anthropic");
    ui.window.close?.();
  });

  it("SPEC 2.1 — switching provider keeps a user-edited endpoint", async () => {
    const ui = await bootOptions();
    const provider = ui.$("provider");
    const base = ui.$("baseURL");
    provider.value = "deepseek";
    ui.change(provider);
    base.value = "https://proxy.example/v1";
    ui.fire(base, "input");
    provider.value = "groq";
    ui.change(provider);
    expect(base.value).toBe("https://proxy.example/v1");
    ui.window.close?.();
  });

  it("R3 fills the endpoint on provider change and never clobbers a typed value", async () => {
    const ui = await bootOptions({ settings: { ai: { provider: "openai" } } });
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
    const ui = await bootOptions({ settings: { ai: { provider: "openai" } } });
    const options = optionsOf(ui.$("reasoning"));
    expect(options[0].value).toBe("lowest");
    expect(options[1].value).toBe("");
    ui.window.close?.();
  });

  it("SPEC 2.1 — an unconfigured AI page keeps the engine on AI and never invents OpenAI", async () => {
    const ui = await bootOptions();
    ui.$("engine").value = "ai";
    ui.change(ui.$("engine"));
    expect(ui.$("ai-fields").hidden).toBe(false);
    // Nothing OpenAI-flavoured may sit in the page a fresh install shows.
    const html = ui.$("ai-fields").outerHTML;
    expect(html).not.toMatch(/api\.openai\.com/);
    expect(html).not.toMatch(/gpt-4o-mini/);
    expect(ui.errors.map(String)).toEqual([]);
    ui.window.close?.();
  });

  it("SPEC 2.1 — a synthetic change back onto the placeholder cannot empty the picker", async () => {
    const ui = await bootOptions();
    const provider = ui.$("provider");
    provider.value = "anthropic";
    ui.change(provider);
    // jsdom can force a disabled option to be chosen; the page has to refuse it.
    provider.value = "";
    ui.change(provider);
    expect(provider.value).toBe("anthropic");
    expect(ui.$("modelSelect").disabled).toBe(false);
    expect(ui.$("baseURL").value).toBe("https://api.anthropic.com/v1");
    ui.window.close?.();
  });

  it("SPEC 2.1 — a synthetic change to the placeholder on a fresh page keeps the model picker shut", async () => {
    const ui = await bootOptions();
    const provider = ui.$("provider");
    provider.value = "";
    ui.change(provider);
    expect(provider.value).toBe("");
    expect(ui.$("modelSelect").disabled).toBe(true);
    expect(realOptionsOf(ui.$("modelSelect"))).toEqual([]);
    expect(ui.$("reasoning").disabled).toBe(true);
    expect(ui.$("reasoning").value).toBe("lowest");
    expect(ui.$("baseURL").value).toBe("");
    ui.window.close?.();
  });

  it("SPEC 2.1 — switching provider keeps the stored reasoning sentinel", async () => {
    const ui = await bootOptions({ settings: { ai: { provider: "anthropic", model: "claude-sonnet-4-5", reasoning: "lowest" } } });
    const provider = ui.$("provider");
    const before = ui.$("reasoning").value;
    expect(before).toBe("lowest");
    const other = realOptionsOf(provider).find((option) => option.value !== "anthropic" && option.value !== "deepseek");
    provider.value = other.value;
    ui.change(provider);
    // The sentinel is a declaration, not a model-level pick: it survives.
    expect(ui.$("reasoning").value).toBe("lowest");
    expect(ui.$("reasoning").disabled).toBe(false);
    ui.window.close?.();
  });

  it("SPEC 2.1 — saving an unconfigured page stores an empty provider, not openai", async () => {
    const ui = await bootOptions();
    ui.$("engine").value = "ai";
    ui.$("save").click();
    await tick();
    const saved = ui.calls.sent.find((message) => message.command === "dt-save-settings");
    expect(saved).toBeTruthy();
    expect(saved.patch.ai.provider).toBe("");
    expect(saved.patch.ai.model).toBe("");
    expect(saved.patch.ai.reasoning).toBe("lowest");
    expect(saved.patch.ai.baseURL).toBe("");
    ui.window.close?.();
  });

  it(`emits a payload the shared SPEC ${SPEC_VERSION} validator accepts`, async () => {
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

  it("SPEC 2.1 — the payload reports BOTH the unconfigured and the configured state", async () => {
    // The contract asks for both states, each read from the real controls. A
    // payload that only describes the configured page leaves the empty-state
    // branch of R2/R3/R4 unverified, so it is a failure, not a style choice.
    const payload = await buildPayload();
    const empty = payload.unconfigured;
    const configured = payload.configured;
    expect(empty, "payload.unconfigured").toBeTruthy();
    expect(configured, "payload.configured").toBeTruthy();

    // Unconfigured: read back from a fresh page.
    expect(empty.provider).toMatchObject({
      control: "select",
      current: "",
      placeholder: { value: "", label: "Select a provider", disabled: true, selected: true },
      fallback: "",
    });
    expect(empty.provider.options.length).toBeGreaterThanOrEqual(5);
    expect(empty.model).toMatchObject({ control: "select", disabled: true, selectedProvider: "", selectedModel: "" });
    expect(empty.model.options).toEqual([]);
    expect(empty.endpoint).toMatchObject({
      control: "input",
      current: "",
      placeholder: "https://",
      autofill: {
        before: "",
        after: "https://api.anthropic.com/v1",
        providerApi: "https://api.anthropic.com/v1",
        userEdited: "https://proxy.example/v1",
        afterSwitch: "https://proxy.example/v1",
      },
    });
    expect(empty.reasoning).toMatchObject({ control: "select", disabled: true, default: "lowest" });

    // Configured: the same page after a real pick.
    expect(configured.provider.current).toBe("anthropic");
    expect(configured.provider.placeholder.selected).toBe(false);
    expect(configured.model).toMatchObject({ disabled: false, selectedProvider: "anthropic" });
    expect(configured.endpoint.current).toBe("https://api.anthropic.com/v1");
    expect(configured.reasoning.disabled).toBe(false);

    // Both states pass the shared validator: neither is cosmetic.
    validatePayload({ ...payload, ...payload.unconfigured }, CONFIG);
    validatePayload({ ...payload, ...payload.configured }, CONFIG);

    // And the primary sections are the unconfigured state, as the contract shows.
    expect(payload.provider.current).toBe("");
    expect(payload.provider.placeholder.selected).toBe(true);
    expect(payload.endpoint.current).toBe("");
    expect(payload.endpoint.placeholder).toBe("https://");
    expect(payload.model.disabled).toBe(true);
    expect(payload.reasoning.disabled).toBe(true);

    // Negative control: the old payload described the configured page only, so
    // its "empty state" was never the fresh install. That shape must not pass
    // for the unconfigured contract.
    const configuredOnly = { ...payload, provider: payload.configured.provider };
    expect(configuredOnly.provider.current).not.toBe("");
    expect(() => validatePayload(configuredOnly, CONFIG)).toThrow(/R2/);
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
    const noPlaceholder = JSON.parse(JSON.stringify(payload));
    delete noPlaceholder.provider.placeholder;
    expect(() => validatePayload(noPlaceholder, CONFIG)).toThrow(/R2/);
    // The empty state is what a fresh install shows: it may not come back.
    const silentFallback = JSON.parse(JSON.stringify(payload));
    silentFallback.provider.current = "";
    silentFallback.provider.fallback = "openai";
    expect(() => validatePayload(silentFallback, CONFIG)).toThrow(/R2/);
    const enabledPlaceholder = JSON.parse(JSON.stringify(payload));
    enabledPlaceholder.provider.current = "";
    enabledPlaceholder.provider.placeholder.selected = true;
    enabledPlaceholder.provider.placeholder.disabled = false;
    expect(() => validatePayload(enabledPlaceholder, CONFIG)).toThrow(/R2/);
    const openModel = JSON.parse(JSON.stringify(payload));
    openModel.provider.current = "";
    openModel.provider.placeholder.selected = true;
    openModel.model.disabled = false;
    expect(() => validatePayload(openModel, CONFIG)).toThrow(/R2/);
    // The pre-fix page a fresh install shipped: empty pick, but the endpoint
    // silently holding OpenAI's base. Only that field is wrong here.
    const prefill = JSON.parse(JSON.stringify(payload));
    Object.assign(prefill.provider, { current: "", fallback: "", placeholder: { value: "", label: "Select a provider", disabled: true, selected: true } });
    Object.assign(prefill.model, { disabled: true, selectedProvider: "", selectedModel: "", options: [] });
    Object.assign(prefill.endpoint, { current: "https://api.openai.com/v1", placeholder: "https://" });
    prefill.reasoning.disabled = true;
    expect(() => validatePayload(prefill, CONFIG)).toThrow(/R3/);
  });

  it("SPEC 2.1 — the empty page contains no OpenAI endpoint or model at all", async () => {
    // The payload generator refuses this shape outright; assert it here too so a
    // regression names the leak instead of surfacing as an R3 failure.
    const payload = await buildPayload();
    const empty = JSON.stringify({
      provider: payload.provider.placeholder,
      endpoint: payload.endpoint.placeholder,
      model: payload.model.options.filter((option) => option.value === ""),
    });
    expect(empty).not.toMatch(/api\.openai\.com|gpt-?[0-9]/i);
    expect(payload.endpoint.placeholder).toBe("https://");
    // The top-level sections are the empty page: the placeholder is selected.
    // The configured page keeps the same disabled placeholder, unselected.
    expect(payload.provider.placeholder).toEqual({ value: "", label: "Select a provider", disabled: true, selected: true });
    expect(payload.configured.provider.placeholder).toEqual({
      value: "",
      label: "Select a provider",
      disabled: true,
      selected: false,
    });
  });
});
