import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, getSettings, setSettings, mapUiLangToTarget, SETTINGS_KEY } from "../src/settings.js";

function mockMessenger(initial = {}) {
  const store = { ...initial };
  return {
    store,
    messenger: {
      storage: {
        local: {
          get: async (defaults) => ({ ...defaults, ...store }),
          set: async (values) => Object.assign(store, values),
        },
      },
    },
  };
}

describe("settings", () => {
  it("returns defaults for an empty store", async () => {
    const { messenger } = mockMessenger();
    const s = await getSettings(messenger);
    expect(s.targetLang).toBe(DEFAULT_SETTINGS.targetLang);
    // No stored default engine: the floating group decides per click.
    expect(s.engine).toBeUndefined();
    expect(s.ai.apiKey).toBe("");
  });

  it("merges persisted partial settings over the defaults", async () => {
    const { messenger } = mockMessenger({ [SETTINGS_KEY]: { targetLang: "fr", ai: { apiKey: "k" } } });
    const s = await getSettings(messenger);
    expect(s.targetLang).toBe("fr");
    expect(s.engine).toBeUndefined();
    expect(s.ai.apiKey).toBe("k");
    expect(s.ai.provider).toBe(DEFAULT_SETTINGS.ai.provider);
  });

  it("persists settings under one key", async () => {
    const { messenger, store } = mockMessenger();
    await setSettings(messenger, { targetLang: "ja" });
    expect(store[SETTINGS_KEY].targetLang).toBe("ja");
    expect(store[SETTINGS_KEY].engine).toBeUndefined();
  });

  it("maps UI locales to a sensible default target", () => {
    expect(mapUiLangToTarget("zh-CN")).toBe("zh-CN");
    expect(mapUiLangToTarget("zh-Hans")).toBe("zh-CN");
    expect(mapUiLangToTarget("de")).toBe("de");
    expect(mapUiLangToTarget("fr-FR")).toBe("fr");
    expect(mapUiLangToTarget("xx-YY")).toBe("en");
  });
});
