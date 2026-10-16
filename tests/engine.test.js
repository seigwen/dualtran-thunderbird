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
