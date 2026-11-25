import { describe, it, expect } from "vitest";
import { createEngine } from "../src/engine.js";

function stubCore(overrides = {}) {
  return {
    translateGoogle: async ({ sourceArray }) => sourceArray.map((s) => `[${s}]`),
    streamChat: async ({ onChunk }) => {
      onChunk("Bon");
      onChunk("jour");
      return { totalChunks: 2, streamError: null };
    },
    buildTranslationMessages: ({ content, targetLanguageName }) => ({
      system: `translate to ${targetLanguageName}`,
      assistant: "ok",
    }),
    codeToLanguageNameInEnglish: (code) => ({ es: "Spanish", fr: "French" })[code] || code,
    formatAiError: (e) => ({ message: `formatted: ${e && e.message ? e.message : e}` }),
    ...overrides,
  };
}

const baseConfig = {
  defaultEngine: "google",
  defaultTargetLang: "en",
  ai: { provider: "openai", apiKey: "test-key", model: "gpt-4o-mini", baseURL: "" },
};

describe("createEngine", () => {
  it("translates a batch through Google and filters blanks", async () => {
    const engine = createEngine({ core: stubCore(), config: baseConfig });
    const res = await engine.translateBatch(["Hola", "  ", "Mundo"]);
    expect(res.translations).toEqual(["[Hola]", "[Mundo]"]);
    expect(res.engine).toBe("google");
    expect(res.targetLang).toBe("en");
  });

  it("returns an empty batch untouched", async () => {
    const engine = createEngine({ core: stubCore(), config: baseConfig });
    const res = await engine.translateBatch(["", "   "]);
    expect(res.translations).toEqual([]);
  });

  it("concatenates AI stream chunks", async () => {
    const engine = createEngine({ core: stubCore(), config: { ...baseConfig, defaultEngine: "ai" } });
    const res = await engine.translateBatch(["Hola"]);
    expect(res.translations).toEqual(["Bonjour"]);
    expect(res.engine).toBe("ai");
  });

  it("keeps the provider's HTTP status on the thrown error", async () => {
    // The classification layer needs the status to say "HTTP 401 — check your
    // API key" instead of echoing the SDK's null-ish message.
    const core = stubCore({
      streamChat: async () => ({ totalChunks: 0, streamError: { statusCode: 401, message: "null" } }),
    });
    const engine = createEngine({ core, config: { ...baseConfig, defaultEngine: "ai" } });
    await expect(engine.translateBatch(["Hola"])).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws a helpful error when the AI engine has no key", async () => {
    const engine = createEngine({
      core: stubCore(),
      config: { ...baseConfig, defaultEngine: "ai", ai: { ...baseConfig.ai, apiKey: "" } },
    });
    await expect(engine.translateBatch(["Hola"])).rejects.toThrow(/no API key/i);
  });

  it("surfaces a formatted error when the AI stream fails", async () => {
    const core = stubCore({
      streamChat: async () => ({ totalChunks: 0, streamError: new Error("boom") }),
    });
    const engine = createEngine({ core, config: { ...baseConfig, defaultEngine: "ai" } });
    await expect(engine.translateBatch(["Hola"])).rejects.toThrow(/formatted: boom/);
  });

  it("reports engine status without exposing the key", () => {
    const engine = createEngine({ core: stubCore(), config: baseConfig });
    const s = engine.status();
    expect(s.google.available).toBe(true);
    expect(s.ai.available).toBe(true);
    expect(JSON.stringify(s)).not.toContain("test-key");
  });
});

describe("createEngine — reasoning depth", () => {
  it("resolves the lowest sentinel against the model's declared levels", async () => {
    let seen;
    const core = stubCore({
      streamChat: async ({ reasoningDepth, onChunk }) => {
        seen = reasoningDepth;
        onChunk("x");
        return { totalChunks: 1, streamError: null };
      },
    });
    const engine = createEngine({
      core,
      config: {
        ...baseConfig,
        ai: { ...baseConfig.ai, reasoning: "lowest" },
        getCatalog: async () => ({ reasoning: { openai: { "gpt-4o-mini": ["minimal", "low"] } } }),
      },
    });
    await engine.translateBatch(["hola"], { engine: "ai" });
    expect(seen).toBe("minimal");
  });

  it("sends nothing when the model declares no levels or the setting is provider default", async () => {
    const seen = [];
    const core = stubCore({
      streamChat: async ({ reasoningDepth, onChunk }) => {
        seen.push(reasoningDepth);
        onChunk("x");
        return { totalChunks: 1, streamError: null };
      },
    });
    const engine = createEngine({
      core,
      config: {
        ...baseConfig,
        ai: { ...baseConfig.ai, reasoning: "lowest" },
        getCatalog: async () => ({ reasoning: { openai: { "gpt-4o-mini": [] } } }),
      },
    });
    await engine.translateBatch(["hola"], { engine: "ai" });
    expect(seen[0]).toBe("");

    const engine2 = createEngine({ core, config: { ...baseConfig, ai: { ...baseConfig.ai, reasoning: "default" } } });
    await engine2.translateBatch(["hola"], { engine: "ai" });
    expect(seen[1]).toBe("");
  });
});

describe("AI request shape (no stray prompt)", () => {
  // The core ships an assistant prefill "I understand. Please give me the text."
  // engine.js used to resend it as a *user* message, so the model sometimes
  // answered "I understand. Please give me the text." (or its Chinese twin
  // "我明白了。请把文本给我。") instead of translating.
  it("sends only the system prompt and the block to translate", async () => {
    const seen = [];
    const core = {
      buildTranslationMessages: () => ({ system: "sys", assistant: "I understand. Please give me the text." }),
      streamChat: async ({ messages, onChunk }) => {
        seen.push(messages);
        onChunk("<译泽>你好</译泽>");
        return { totalChunks: 1 };
      },
      formatAiError: (e) => ({ message: String(e) }),
      codeToLanguageNameInEnglish: () => "Chinese",
    };
    const engine = createEngine({
      core,
      config: {
        ...baseConfig,
        defaultEngine: "ai",
        ai: { provider: "ollama-cloud", apiKey: "k", model: "m", reasoning: "lowest", baseURL: "" },
      },
    });
    await engine.translateBatch(["Hello world"], { engine: "ai", targetLang: "zh-CN" });
    expect(seen).toHaveLength(1);
    const roles = seen[0].map((m) => m.role);
    expect(roles).toEqual(["system", "user"]);
    expect(seen[0][1].content).toBe("Hello world");
  });

  it("discards a reply that is the model talking about the task", async () => {
    const core = {
      buildTranslationMessages: () => ({ system: "sys", assistant: "I understand. Please give me the text." }),
      streamChat: async ({ onChunk }) => {
        onChunk("我明白了。请把文本给我。");
        return { totalChunks: 1 };
      },
      formatAiError: (e) => ({ message: String(e) }),
      codeToLanguageNameInEnglish: () => "Chinese",
    };
    const engine = createEngine({
      core,
      config: {
        ...baseConfig,
        defaultEngine: "ai",
        ai: { provider: "ollama-cloud", apiKey: "k", model: "m", reasoning: "lowest", baseURL: "" },
      },
    });
    const out = await engine.translateBatch(["Hello world"], { engine: "ai", targetLang: "zh-CN" });
    // An empty result makes the content script show "no translatable text"
    // rather than pasting the model's meta-reply into the message.
    expect(out.translations).toEqual([""]);
  });
});
