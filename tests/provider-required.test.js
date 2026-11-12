import { describe, it, expect, vi, afterEach } from "vitest";

import { createEngine } from "../src/engine.js";
import { DEFAULT_SETTINGS, getSettings } from "../src/settings.js";
import { registerBackground } from "../src/background.js";

/**
 * SPEC 2.1 — unconfigured AI provider.
 *
 * A fresh install has no AI provider (`""`). Every AI path must say so with the
 * localized `providerRequiredError` and must not touch the network. These are
 * negative assertions: the pre-fix code sent "openai"/"gpt-4o-mini" to
 * api.openai.com, so each one fails loudly if a fallback comes back.
 */

const PROVIDER_REQUIRED = "Choose an AI provider in settings before translating.";

function stubCore(overrides = {}) {
  return {
    translateGoogle: vi.fn(async ({ sourceArray }) => sourceArray.map((s) => `[${s}]`)),
    streamChat: vi.fn(async ({ onChunk }) => {
      onChunk("Bonjour");
      return { totalChunks: 1, streamError: null };
    }),
    buildTranslationMessages: ({ content, targetLanguageName }) => ({
      system: `translate to ${targetLanguageName}`,
      assistant: "ok",
    }),
    codeToLanguageNameInEnglish: (code) => code,
    formatAiError: (e) => ({ message: `formatted: ${e && e.message ? e.message : e}` }),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SPEC 2.1 — fresh settings", () => {
  it("default provider is empty, the reasoning sentinel and model stay as declared", () => {
    expect(DEFAULT_SETTINGS.ai.provider).toBe("");
    expect(DEFAULT_SETTINGS.ai.model).toBe("");
    expect(DEFAULT_SETTINGS.ai.reasoning).toBe("lowest");
    expect(DEFAULT_SETTINGS.ai.baseURL).toBe("");
  });

  it("merges defaults without rewriting a stored provider", async () => {
    const store = {};
    const messenger = {
      storage: {
        local: {
          get: async (defaults) => ({ ...defaults, ...store }),
          set: async (values) => Object.assign(store, values),
        },
      },
    };
    expect((await getSettings(messenger)).ai.provider).toBe("");

    store.dtSettings = { ai: { provider: "anthropic", model: "claude-sonnet-4-5" } };
    const kept = await getSettings(messenger);
    expect(kept.ai.provider).toBe("anthropic");
    expect(kept.ai.model).toBe("claude-sonnet-4-5");
    expect(kept.ai.reasoning).toBe("lowest");
  });
});

describe("SPEC 2.1 — engine refuses to pick a provider", () => {
  it("empty provider throws providerRequiredError and makes zero core/network calls", async () => {
    const core = stubCore();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const engine = createEngine({
      core,
      config: { defaultEngine: "ai", defaultTargetLang: "en", ai: { provider: "", apiKey: "k", model: "", baseURL: "" } },
    });

    await expect(engine.translateBatch(["Hola"])).rejects.toThrow(PROVIDER_REQUIRED);
    expect(core.streamChat).not.toHaveBeenCalled();
    expect(core.translateGoogle).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("empty provider throws even when no API key is set (provider is the first blocker)", async () => {
    const core = stubCore();
    const engine = createEngine({
      core,
      config: { defaultEngine: "ai", defaultTargetLang: "en", ai: { provider: "", apiKey: "", model: "", baseURL: "" } },
    });
    await expect(engine.translateBatch(["Hola"])).rejects.toThrow(PROVIDER_REQUIRED);
    expect(core.streamChat).not.toHaveBeenCalled();
  });

  it("never sends an OpenAI endpoint or model for an unconfigured provider", async () => {
    const seen = [];
    const core = stubCore({
      streamChat: vi.fn(async ({ extra, provider, model, onChunk }) => {
        seen.push({ extra, provider, model });
        onChunk("x");
        return { totalChunks: 1, streamError: null };
      }),
    });
    const engine = createEngine({
      core,
      config: { defaultEngine: "ai", defaultTargetLang: "en", ai: { provider: "", apiKey: "k", model: "", baseURL: "" } },
    });
    await engine.translateBatch(["Hola"]).catch(() => {});
    expect(seen).toEqual([]);
  });

  it("still translates once a provider is configured", async () => {
    const core = stubCore();
    const engine = createEngine({
      core,
      config: {
        defaultEngine: "ai",
        defaultTargetLang: "en",
        ai: { provider: "anthropic", apiKey: "k", model: "claude-sonnet-4-5", baseURL: "", reasoning: "lowest" },
      },
    });
    const res = await engine.translateBatch(["Hola"]);
    expect(res.translations).toEqual(["Bonjour"]);
    expect(core.streamChat).toHaveBeenCalledTimes(1);
  });
});

describe("SPEC 2.1 — background route", () => {
  function messengerStub(settings) {
    const captured = {};
    return {
      captured,
      messenger: {
        runtime: { onMessage: { addListener: (fn) => (captured.onMessage = fn) } },
        scripting: {
          compose: { registerScripts: async () => {} },
          messageDisplay: { registerScripts: async () => {} },
        },
        tabs: { query: async () => [] },
      },
      getSettingsFn: async () => settings,
    };
  }

  it("an unconfigured provider never reaches the engine", async () => {
    const engine = { translateBatch: vi.fn(async () => ({ translations: [] })) };
    const { messenger, captured, getSettingsFn } = messengerStub({
      engine: "ai",
      targetLang: "en",
      ai: { provider: "", apiKey: "k", model: "", baseURL: "", reasoning: "lowest" },
    });
    await registerBackground({ messenger, engine, getSettingsFn });
    const out = await captured.onMessage({ command: "dt-translate", texts: ["Hola"] });
    expect(out.error).toBe(PROVIDER_REQUIRED);
    expect(engine.translateBatch).not.toHaveBeenCalled();
  });
});
