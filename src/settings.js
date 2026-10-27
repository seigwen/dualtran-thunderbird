/**
 * Settings live in storage.local under one key. The default target language
 * follows the Thunderbird UI language on first run (email users expect their
 * own language, not necessarily English).
 */

export const SETTINGS_KEY = "dtSettings";

const SUPPORTED_TARGETS = ["en", "zh-CN", "ja", "ko", "fr", "de", "es", "pt", "ru", "it"];

export const DEFAULT_SETTINGS = Object.freeze({
  targetLang: "en",
  engine: "google",
  ai: {
    provider: "openai",
    apiKey: "",
    model: "gpt-4o-mini",
    reasoning: "lowest",
    baseURL: "",
  },
});

/** Map a UI locale (e.g. "zh-Hans-CN", "de") onto a supported target code. */
export function mapUiLangToTarget(lang) {
  const l = String(lang || "").toLowerCase();
  if (l.startsWith("zh")) return "zh-CN";
  const two = l.split("-")[0];
  return SUPPORTED_TARGETS.includes(two) ? two : "en";
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = deepMerge(base[key] && typeof base[key] === "object" ? base[key] : {}, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function uiDefaultTarget(messenger) {
  const lang = messenger && messenger.i18n && messenger.i18n.getUILanguage ? messenger.i18n.getUILanguage() : "en";
  return mapUiLangToTarget(lang);
}

export async function getSettings(messenger) {
  const stored = (await messenger.storage.local.get({ [SETTINGS_KEY]: {} }))[SETTINGS_KEY] || {};
  const defaults = { ...DEFAULT_SETTINGS, targetLang: uiDefaultTarget(messenger) };
  return deepMerge(defaults, stored);
}

export async function setSettings(messenger, patch) {
  const current = await getSettings(messenger);
  const next = deepMerge(current, patch);
  await messenger.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
