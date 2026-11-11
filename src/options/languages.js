/**
 * languages.js — the target-language table behind the options page.
 *
 * The `<select id="targetLang">` is built from this list instead of 38 hardcoded
 * `<option>` lines, so adding a language is a one-line change here and the HTML
 * stays a skeleton. Codes are the same BCP-47 tags the engine and the locale
 * catalogues use (`zh-CN`, `pt-BR`, …); the label is always `Name (code)` —
 * the picker is a closed list, there is no free-text code to type.
 *
 * Source of truth: facts/language-names.json (checked by tests/conformance.test.js).
 * Exposed as `window.DualTranLanguages` and as `module.exports` for Node tests.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DualTranLanguages = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** [code, English name] — alphabetical by name, which is how the picker reads. */
  const LANGUAGES = [
    ["af", "Afrikaans"],
    ["ar", "Arabic"],
    ["bn", "Bengali"],
    ["bg", "Bulgarian"],
    ["ca", "Catalan"],
    ["zh-CN", "Chinese (Simplified)"],
    ["zh-TW", "Chinese (Traditional)"],
    ["hr", "Croatian"],
    ["cs", "Czech"],
    ["da", "Danish"],
    ["nl", "Dutch"],
    ["en", "English"],
    ["et", "Estonian"],
    ["fa", "Persian"],
    ["fi", "Finnish"],
    ["fr", "French"],
    ["de", "German"],
    ["el", "Greek"],
    ["he", "Hebrew"],
    ["hi", "Hindi"],
    ["hu", "Hungarian"],
    ["id", "Indonesian"],
    ["it", "Italian"],
    ["ja", "Japanese"],
    ["ko", "Korean"],
    ["lv", "Latvian"],
    ["lt", "Lithuanian"],
    ["ms", "Malay"],
    ["no", "Norwegian"],
    ["pl", "Polish"],
    ["pt", "Portuguese"],
    ["pt-BR", "Portuguese (Brazil)"],
    ["ro", "Romanian"],
    ["ru", "Russian"],
    ["sr", "Serbian"],
    ["sk", "Slovak"],
    ["sl", "Slovenian"],
    ["es", "Spanish"],
    ["sv", "Swedish"],
    ["th", "Thai"],
    ["tr", "Turkish"],
    ["uk", "Ukrainian"],
    ["ur", "Urdu"],
    ["vi", "Vietnamese"],
  ];

  const DEFAULT_LANGUAGE = "en";

  /** Visible text for a picker row: `Name (code)`. */
  function labelFor(code, name) {
    return `${name} (${code})`;
  }

  /** [{ value, label }] in display order — the shape the options page renders. */
  function languageOptions() {
    return LANGUAGES.map(([code, name]) => ({ value: code, label: labelFor(code, name) }));
  }

  /** A stored code the table no longer knows falls back to English. */
  function normalizeCode(code) {
    const value = String(code || "").trim();
    return LANGUAGES.some(([known]) => known === value) ? value : DEFAULT_LANGUAGE;
  }

  return { LANGUAGES, DEFAULT_LANGUAGE, labelFor, languageOptions, normalizeCode };
});
