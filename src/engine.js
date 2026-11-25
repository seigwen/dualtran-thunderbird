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

/**
 * SPEC 2.1 — the unconfigured-provider message. `errors` is the messenger i18n
 * facade (or `{ getMessage }`); the English text is the source string, so a
 * missing catalogue still yields something actionable.
 */
export const PROVIDER_REQUIRED_ERROR = "Choose an AI provider in settings before translating.";

export function providerRequiredError(errors) {
  const text = errors && typeof errors.getMessage === "function" ? errors.getMessage("providerRequiredError") : "";
  return new Error(text || PROVIDER_REQUIRED_ERROR);
}

/** A provider id the user actually chose: anything else is "not configured". */
export function isProviderChosen(provider) {
  return typeof provider === "string" && provider.trim() !== "";
}

/**
 * Sentences a model emits when it mistakes the task for a conversation window.
 * `buildTranslationMessages` supplies an assistant prefill ending in
 * "Please give me the text.", and some providers echo it - in English or in the
 * target language - instead of translating. Such a reply must never reach the
 * page: it reads as a broken translation.
 *
 * Deliberately narrow: only a short reply that *starts* with one of these
 * shapes is dropped, so a real translation that happens to contain the words
 * later in the sentence survives.
 */
const META_REPLY_RE =
  /^(?:i understand\b|please (?:provide|give)\b|i'?m ready\b|send me the\b|我明白了|好的[，,]?\s*请|请(?:提供|把|给我|发送)|收到[，,]?\s*请|明白了[，,]?\s*请)/i;

export function isMetaReply(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  // A long paragraph is prose, not a one-line acknowledgement.
  if (t.length > 120) return false;
  return META_REPLY_RE.test(t);
}

export function createEngine({ core, config, fetchImpl = null }) {
  async function translateAi(texts, targetLang, aiSettings) {
    const { provider, apiKey, model, baseURL, reasoning } = aiSettings ?? config.ai;
    // Never guess a provider (no `|| "openai"`): an empty pick means the user
    // has not configured the AI engine yet. No network request is made.
    if (!isProviderChosen(provider)) throw providerRequiredError(config.i18n);
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
      // Only the system prompt and the block itself. The core ships an
      // assistant prefill ("I understand. Please give me the text."); resending it
      // as a *user* turn made the model answer that sentence (or its Chinese twin
      // "我明白了。请把文本给我。") instead of translating.
      const messages = [
        { role: "system", content: prompt.system },
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
        // Keep the provider's status/body on the error we throw: the message
        // alone is often a stringified null and cannot be classified later.
        const formatted = core.formatAiError(streamError);
        const error = new Error(formatted.message);
        error.cause = streamError;
        const status = streamError && (streamError.statusCode || streamError.status);
        if (status) error.statusCode = status;
        if (streamError && streamError.responseBody) error.responseBody = streamError.responseBody;
        if (streamError && streamError.data) error.data = streamError.data;
        throw error;
      }
      if (totalChunks === 0) {
        throw new Error("No response from AI provider");
      }
      const cleaned = text.trim();
      results.push(isMetaReply(cleaned) ? "" : cleaned);
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
