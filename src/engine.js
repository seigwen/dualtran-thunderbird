/**
 * The translation engine behind the extension - same contract as the MCP
 * server and the other workbench hosts: Google as one batched
 * core.translateGoogle call, AI as one streaming chat per text via
 * core.streamChat. Fully dependency-injected so tests run against a stub
 * core with no network.
 */

/**
 * @param {object} args
 * @param {object} args.core  the dualtran core module (or a stub in tests)
 * @param {{defaultEngine: string, defaultTargetLang: string,
 *          ai: {provider: string, apiKey: string, model: string, baseURL: string}}} args.config
 * @param {Function|null} [args.fetchImpl]
 */
/** Lowest level a model accepts; nothing declared means "send no parameter". */
export function resolveReasoning(setting, levels) {
  if (!setting || setting === "default") return "";
  if (setting !== "lowest") return setting;
  const values = Array.isArray(levels) ? levels : [];
  for (const level of ["none", "minimal", "low"]) {
    if (values.includes(level)) return level;
  }
  return "";
}

export function createEngine({ core, config, fetchImpl = null }) {
  async function translateAi(texts, targetLang, aiSettings) {
    const { provider, apiKey, model, baseURL, reasoning } = aiSettings ?? config.ai;
    if (!apiKey) {
      throw new Error(
        "AI engine selected but no API key configured - open the DualTran options page (or set a provider key) first."
      );
    }
    const catalog = config.getCatalog ? await config.getCatalog() : null;
    const declared = (catalog && catalog.reasoning && catalog.reasoning[provider] && catalog.reasoning[provider][model]) || [];
    const reasoningDepth = resolveReasoning(reasoning, declared);
    const results = [];
    for (const content of texts) {
      const targetLanguageName =
        (core.codeToLanguageNameInEnglish && core.codeToLanguageNameInEnglish(targetLang)) || targetLang;
      const prompt = core.buildTranslationMessages({ content, targetLanguageName });
      const messages = [
        { role: "system", content: prompt.system },
        { role: "user", content: "I understand. Please give me the text." },
        { role: "user", content },
      ];
      let text = "";
      const { totalChunks, streamError } = await core.streamChat({
        provider,
        apiKey,
        model,
        messages,
        reasoningDepth,
        extra: baseURL ? { baseURL } : {},
        store: null,
        onChunk: (chunk) => {
          text += chunk;
        },
      });
      if (streamError) {
        throw new Error(core.formatAiError(streamError).message);
      }
      if (totalChunks === 0) {
        throw new Error("No response from AI provider");
      }
      results.push(text);
    }
    return results;
  }

  return {
    /** Translate a batch of texts. Blank input returns an empty batch untouched. */
    async translateBatch(texts, options = {}) {
      const engineName = options.engine ?? config.defaultEngine;
      const targetLang = options.targetLang ?? config.defaultTargetLang;
      const sourceLang = options.sourceLang ?? "auto";
      const filtered = (texts || []).map((text) => String(text).trim()).filter((text) => text.length > 0);
      if (filtered.length === 0) {
        return { translations: [], engine: engineName, targetLang };
      }
      if (engineName === "ai") {
        return {
          translations: await translateAi(filtered, targetLang, options.ai),
          engine: engineName,
          targetLang,
        };
      }
      const translations = await core.translateGoogle({
        sourceArray: filtered,
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
        cache: null,
        fetchImpl,
      });
      return { translations, engine: engineName, targetLang };
    },

    /** Availability report for the options page - never exposes the key. */
    status() {
      return {
        google: { available: true, note: "Free, no account required." },
        ai: {
          available: config.ai.apiKey.length > 0,
          provider: config.ai.provider,
          model: config.ai.model,
          baseUrlOverride: config.ai.baseURL.length > 0,
        },
        defaultEngine: config.defaultEngine,
        defaultTargetLang: config.defaultTargetLang,
      };
    },
  };
}
