/**
 * Extension entry point (bundled into dist/background.js with the dualtran
 * core inlined). Keeps the real wiring separate from the pure background
 * module so tests never touch the messenger global.
 */
import * as core from "dualtran";
import { createEngine } from "./engine.js";
import { getSettings, setSettings, mapUiLangToTarget } from "./settings.js";
import { registerBackground } from "./background.js";

const api = globalThis.messenger ?? globalThis.browser;

const uiLang = api.i18n && api.i18n.getUILanguage ? api.i18n.getUILanguage() : "en";

const debugFn = (text) => {
  try {
    if (globalThis.dump) globalThis.dump(`[dualtran] ${text}\n`);
  } catch (_) {
    /* dump unavailable */
  }
};

const engine = createEngine({
  core,
  config: {
    defaultEngine: "google",
    defaultTargetLang: mapUiLangToTarget(uiLang),
    ai: { provider: "openai", apiKey: "", model: "gpt-4o-mini", baseURL: "" },
  },
  fetchImpl: null, // default fetch: the extension context has host_permissions
  // Cached models.dev projection written by the options page; the engine reads
  // it to resolve the "lowest" reasoning sentinel against the chosen model.
  getCatalog: async () => {
    const stored = await api.storage.local.get({ dtCatalog: null });
    return (stored.dtCatalog && stored.dtCatalog.data) || null;
  },
});

registerBackground({
  messenger: api,
  engine,
  getSettingsFn: () => getSettings(api),
  setSettingsFn: (patch) => setSettings(api, patch),
  debugFn,
  tabInjectRetries: 8,
})
  .then(() => debugFn("background ready"))
  .catch((error) => debugFn(`background registration failed: ${error}`));
