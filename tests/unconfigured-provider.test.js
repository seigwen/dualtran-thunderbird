import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as esbuild from "esbuild";

import {
  isProviderChosen,
  providerRequiredError,
  PROVIDER_REQUIRED_ERROR,
  createEngine,
} from "../src/engine.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { registerBackground } from "../src/background.js";

/**
 * SPEC 2.1 — the unconfigured state must be explicit on every AI entry point.
 *
 * These are negative assertions on purpose: the pre-fix behaviour (silently
 * sending OpenAI's endpoint/model) must fail here, so no fallback can come
 * back without turning one of these red.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The content scripts are ES modules (esbuild bundles them for the extension),
 * but the real page evaluates them as one classic script. Bundle the entry with
 * the repo's own esbuild so imports resolve exactly as they do in dist/.
 */
function bundleContentScript(root, entry) {
  const result = esbuild.buildSync({
    entryPoints: [path.join(root, "src", entry)],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["firefox128"],
    define: { __DT_SMOKE__: "false" },
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

/** The English source string every guard must surface when i18n is missing. */
const SOURCE = "Choose an AI provider in settings before translating.";

const AI_EMPTY = { provider: "", apiKey: "sk-test", model: "", baseURL: "", reasoning: "lowest" };
const AI_SET = { provider: "anthropic", apiKey: "sk-test", model: "claude-sonnet-4-5", baseURL: "", reasoning: "lowest" };

function stubCore(overrides = {}) {
  return {
    translateGoogle: vi.fn(async ({ sourceArray }) => sourceArray.map((s) => `[${s}]`)),
    streamChat: vi.fn(async ({ onChunk }) => {
      onChunk("Bonjour");
      return { totalChunks: 1, streamError: null };
    }),
    buildTranslationMessages: ({ targetLanguageName }) => ({ system: `to ${targetLanguageName}` }),
    codeToLanguageNameInEnglish: (code) => code,
    formatAiError: (e) => ({ message: String((e && e.message) || e) }),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SPEC 2.1 — provider guard helpers", () => {
  it("treats only a non-blank string as a chosen provider", () => {
    for (const value of ["", "   ", "\t", null, undefined, 0, {}]) {
      expect(isProviderChosen(value)).toBe(false);
    }
    expect(isProviderChosen("openai")).toBe(true);
    expect(isProviderChosen(" anthropic ")).toBe(true);
  });

  it("localizes providerRequiredError through getMessage and falls back to the English source", () => {
    expect(providerRequiredError({ getMessage: (key) => (key === "providerRequiredError" ? "翻译前请先在设置中选择 AI 提供商。" : "") }).message).toBe(
      "翻译前请先在设置中选择 AI 提供商。"
    );
    // No facade, a facade that does not know the key, or a broken one: the
    // English source string still lands in the error, never an empty message.
    expect(providerRequiredError(null).message).toBe(SOURCE);
    expect(providerRequiredError({ getMessage: () => "" }).message).toBe(SOURCE);
    expect(providerRequiredError({}).message).toBe(SOURCE);
    expect(PROVIDER_REQUIRED_ERROR).toBe(SOURCE);
  });

  it("the declared default settings carry no provider and no OpenAI leftovers", () => {
    expect(DEFAULT_SETTINGS.ai.provider).toBe("");
    expect(DEFAULT_SETTINGS.ai.model).toBe("");
    expect(JSON.stringify(DEFAULT_SETTINGS.ai)).not.toMatch(/api\.openai\.com|gpt-/i);
  });
});

describe("SPEC 2.1 — engine: empty provider sends nothing", () => {
  it("throws providerRequiredError before reading the API key", async () => {
    const core = stubCore();
    const engine = createEngine({ core, config: { defaultEngine: "ai", defaultTargetLang: "en", ai: AI_EMPTY } });
    await expect(engine.translateBatch(["Hola"])).rejects.toThrow(SOURCE);
    expect(core.streamChat).not.toHaveBeenCalled();
  });

  it("applies the same guard to per-request ai settings (options.ai), not just config.ai", async () => {
    const core = stubCore();
    const engine = createEngine({ core, config: { defaultEngine: "google", defaultTargetLang: "en", ai: AI_SET } });
    await expect(engine.translateBatch(["Hola"], { engine: "ai", ai: AI_EMPTY })).rejects.toThrow(SOURCE);
    expect(core.streamChat).not.toHaveBeenCalled();
    expect(core.translateGoogle).not.toHaveBeenCalled();
  });

  it("localized message reaches the caller when config.i18n is wired", async () => {
    const engine = createEngine({
      core: stubCore(),
      config: {
        defaultEngine: "ai",
        defaultTargetLang: "en",
        ai: AI_EMPTY,
        i18n: { getMessage: (key) => (key === "providerRequiredError" ? "请选择 AI 提供商" : "") },
      },
    });
    await expect(engine.translateBatch(["Hola"])).rejects.toThrow("请选择 AI 提供商");
  });

  it("whitespace-only provider is treated as unconfigured (no request)", async () => {
    const core = stubCore();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const engine = createEngine({
      core,
      config: { defaultEngine: "ai", defaultTargetLang: "en", ai: { ...AI_EMPTY, provider: "   " } },
    });
    await expect(engine.translateBatch(["Hola"])).rejects.toThrow(SOURCE);
    expect(core.streamChat).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("SPEC 2.1 — background: dt-translate short-circuits", () => {
  function harness(settings, i18n = null) {
    const captured = {};
    const engine = { translateBatch: vi.fn(async () => ({ translations: ["x"], engine: "ai", targetLang: "en" })) };
    const messenger = {
      runtime: { onMessage: { addListener: (fn) => (captured.onMessage = fn) } },
      scripting: {
        compose: { registerScripts: async () => {} },
        messageDisplay: { registerScripts: async () => {} },
      },
      tabs: { query: async () => [] },
      i18n: i18n || { getMessage: () => "" },
    };
    return { captured, engine, messenger };
  }

  it("returns providerRequiredError as the result shape the content scripts read", async () => {
    const { captured, engine, messenger } = harness({ engine: "ai", ai: AI_EMPTY, targetLang: "en" });
    await registerBackground({ messenger, engine, getSettingsFn: async () => ({ engine: "ai", ai: AI_EMPTY, targetLang: "en" }) });
    const out = await captured.onMessage({ command: "dt-translate", texts: ["Hola"] });
    expect(out).toEqual({ error: SOURCE });
    expect(engine.translateBatch).not.toHaveBeenCalled();
  });

  it("uses the injected i18n facade, so the message is localized", async () => {
    const { captured, engine, messenger } = harness(null, { getMessage: (key) => (key === "providerRequiredError" ? "翻译前请先在设置中选择 AI 提供商。" : "") });
    await registerBackground({ messenger, engine, getSettingsFn: async () => ({ engine: "ai", ai: AI_EMPTY, targetLang: "en" }) });
    const out = await captured.onMessage({ command: "dt-translate", texts: ["Hola"] });
    expect(out.error).toBe("翻译前请先在设置中选择 AI 提供商。");
    expect(engine.translateBatch).not.toHaveBeenCalled();
  });

  it("an explicit per-message engine ai with a provider-less setting is refused too", async () => {
    const { captured, engine, messenger } = harness(null);
    // Stored engine is google, the message asks for ai: the guard follows the request.
    await registerBackground({ messenger, engine, getSettingsFn: async () => ({ engine: "google", ai: AI_EMPTY, targetLang: "en" }) });
    const out = await captured.onMessage({ command: "dt-translate", texts: ["Hola"], engine: "ai" });
    expect(out).toEqual({ error: SOURCE });
    expect(engine.translateBatch).not.toHaveBeenCalled();
  });

  it("does not block a configured provider", async () => {
    const { captured, engine, messenger } = harness(null);
    await registerBackground({ messenger, engine, getSettingsFn: async () => ({ engine: "ai", ai: AI_SET, targetLang: "en" }) });
    const out = await captured.onMessage({ command: "dt-translate", texts: ["Hola"] });
    expect(out.translations).toEqual(["x"]);
    expect(engine.translateBatch).toHaveBeenCalledTimes(1);
  });

  it("dt-settings answers with the engine and provider only — never the API key", async () => {
    const { captured, engine, messenger } = harness(null);
    await registerBackground({
      messenger,
      engine,
      getSettingsFn: async () => ({ engine: "ai", targetLang: "en", ai: { provider: "", apiKey: "sk-secret", model: "m", baseURL: "" } }),
    });
    const out = await captured.onMessage({ command: "dt-settings" });
    expect(out).toEqual({ settings: { engine: "ai", targetLang: "en", ai: { provider: "" } } });
    expect(JSON.stringify(out)).not.toMatch(/sk-secret/);
  });
});

/**
 * The reading-pane / compose button is the primary action on those surfaces:
 * while no provider is configured it must be disabled and explain why, using
 * the same providerRequiredError string as a title (tooltip).
 */
describe("SPEC 2.1 — translate button explains the missing provider", () => {
  const PROVIDER_REQUIRED_ZH = "翻译前请先在设置中选择 AI 提供商。";

  function bootContent(script, { provider, messages }) {
    const dom = new JSDOM("<!doctype html><html><body><div id=\"messageEditor\"><p>Hello world, this is prose.</p></div></body></html>", {
      url: "https://mail.test/message.html",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    });
    const { window } = dom;
    const calls = [];
    window.browser = {
      i18n: {
        getMessage: (key) => messages[key] ?? "",
        getUILanguage: () => "en",
      },
      storage: { local: { get: async (defaults) => ({ ...defaults, dtSettings: provider }), set: async () => {} } },
      runtime: { sendMessage: async (message) => {
        calls.push(message);
        if (message.command === "dt-settings") return { settings: provider };
        return undefined;
      } },
    };
    window.__dtDualSpan = {};
    const ctx = vm.createContext(window);
    vm.runInContext(bundleContentScript(ROOT, script), ctx);
    return { window, document: window.document, calls };
  }

  async function settle(document) {
    for (let i = 0; i < 50; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (document.getElementById("dt-fab")) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const MESSAGES = {
    btnTranslate: "Translate",
    btnComposeTranslate: "Translate this email",
    btnTranslating: "Translating…",
    btnShowOriginal: "Show original",
    errorTranslate: "Translation failed: $DETAIL$",
    providerRequiredError: SOURCE,
  };

  for (const [script, label] of [["messageDisplay/content.js", "reading pane"], ["compose/content.js", "compose window"]]) {
    it(`${label}: disabled + titled while the AI provider is empty, enabled when configured`, async () => {
      const empty = bootContent(script, { provider: { engine: "ai", ai: AI_EMPTY }, messages: MESSAGES });
      await settle(empty.document);
      const fab = empty.document.getElementById("dt-fab");
      expect(fab).toBeTruthy();
      expect(fab.disabled).toBe(true);
      expect(fab.getAttribute("title")).toBe(SOURCE);
      // Clicking a disabled primary button must not send a translation request.
      fab.dispatchEvent(new empty.window.Event("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(empty.calls.filter((call) => call.command === "dt-translate")).toEqual([]);
      empty.window.close?.();

      const ready = bootContent(script, { provider: { engine: "ai", ai: AI_SET }, messages: MESSAGES });
      await settle(ready.document);
      const live = ready.document.getElementById("dt-fab");
      expect(live.disabled).toBe(false);
      expect(live.getAttribute("title")).toBeFalsy();
      ready.window.close?.();
    });

    it(`${label}: the tooltip is the localized providerRequiredError`, async () => {
      const ui = bootContent(script, {
        provider: { engine: "ai", ai: AI_EMPTY },
        messages: { ...MESSAGES, providerRequiredError: PROVIDER_REQUIRED_ZH },
      });
      await settle(ui.document);
      expect(ui.document.getElementById("dt-fab").getAttribute("title")).toBe(PROVIDER_REQUIRED_ZH);
      ui.window.close?.();
    });

    it(`${label}: the Google engine is never blocked by an empty AI provider`, async () => {
      const ui = bootContent(script, { provider: { engine: "google", ai: AI_EMPTY }, messages: MESSAGES });
      await settle(ui.document);
      const fab = ui.document.getElementById("dt-fab");
      expect(fab.disabled).toBe(false);
      expect(fab.getAttribute("title")).toBeFalsy();
      ui.window.close?.();
    });
  }
});
