import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every host platform ships the same 38 languages (see
 * DualTran-manage/98-all-platforms-i18n-audit-plan.md). These tests keep the
 * Thunderbird catalogue from drifting: missing key, empty value, lost
 * placeholder, or a Chinese string left behind in a non-Chinese locale.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = path.join(ROOT, "_locales");

const EXPECTED = [
  "af", "ar", "ca", "cs", "da", "de", "el", "en", "es", "fa", "fi", "fr", "he", "hi", "hr",
  "hu", "is", "it", "ja", "ko", "lv", "nl", "no", "pl", "pt_BR", "pt_PT", "ro", "ru", "sl",
  "sr", "sv", "th", "tr", "ug", "uk", "vi", "zh_CN", "zh_TW",
];

function read(code) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES, code, "messages.json"), "utf8"));
}

const en = read("en");
const enKeys = Object.keys(en);

describe("locale catalogues", () => {
  it("ships exactly the 38 agreed languages", () => {
    const codes = fs
      .readdirSync(LOCALES)
      .filter((code) => fs.existsSync(path.join(LOCALES, code, "messages.json")))
      .sort();
    expect(codes).toEqual([...EXPECTED].sort());
  });

  it("has every English key, non-empty, in every locale", () => {
    for (const code of EXPECTED) {
      const catalogue = read(code);
      expect(Object.keys(catalogue), `${code}: key set`).toEqual(enKeys);
      for (const key of enKeys) {
        const value = catalogue[key] && catalogue[key].message;
        expect(typeof value === "string" && value.trim().length > 0, `${code}: ${key}`).toBe(true);
      }
    }
  });

  it("keeps the $DETAIL$ placeholder and its placeholder block", () => {
    for (const code of EXPECTED) {
      const entry = read(code).errorTranslate;
      expect(entry.message, `${code}: $DETAIL$`).toContain("$DETAIL$");
      expect(entry.placeholders, `${code}: placeholders`).toEqual(en.errorTranslate.placeholders);
    }
  });

  it("only references keys the catalogue actually defines", () => {
    // A data-i18n key with no entry renders its raw id in every language
    // (optionApiKeyHint shipped like that until the e2e caught it).
    const used = new Set();
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(html|js)$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf8");
          for (const match of text.matchAll(/data-i18n="([^"]+)"/g)) used.add(match[1]);
          for (const match of text.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) used.add(match[1]);
          for (const match of text.matchAll(/i18n\.getMessage\(\s*"([A-Za-z0-9_]+)"/g)) used.add(match[1]);
        }
      }
    };
    walk(path.join(ROOT, "src"));
    const missing = [...used].filter((key) => !en[key]);
    expect(missing, `keys used in src but absent from _locales/en: ${missing.join(", ")}`).toEqual([]);
  });

  it("ships the SPEC 2.1 provider keys with the agreed source strings", () => {
    expect(en.providerPlaceholder.message).toBe("Select a provider");
    expect(en.providerRequiredForModel.message).toBe("Select a provider first");
    expect(en.providerRequiredError.message).toBe("Choose an AI provider in settings before translating.");
    // Chinese is hand-written, never machine-translated.
    for (const code of ["zh_CN", "zh_TW"]) {
      const catalogue = read(code);
      expect(catalogue.providerPlaceholder.message).toMatch(/选择 AI 提供商|選擇 AI 提供商/);
      expect(catalogue.providerRequiredForModel.message).toMatch(/请先选择提供商|請先選擇提供商/);
      expect(catalogue.providerRequiredError.message).toMatch(/翻译前请先在设置中|翻譯前請先在設定中/);
    }
    // Every other locale got its own translation, not the English source.
    for (const code of EXPECTED) {
      if (code === "en") continue;
      const catalogue = read(code);
      expect(catalogue.providerPlaceholder.message, `${code}: placeholder`).not.toBe(en.providerPlaceholder.message);
      expect(catalogue.providerRequiredForModel.message, `${code}: model hint`).not.toBe(en.providerRequiredForModel.message);
      expect(catalogue.providerRequiredError.message, `${code}: error`).not.toBe(en.providerRequiredError.message);
    }
  });

  it("does not leave Chinese in non-Chinese locales", () => {
    for (const code of EXPECTED) {
      // Japanese legitimately uses kanji; Chinese is a source language.
      if (code.startsWith("zh") || code.startsWith("ja")) continue;
      expect(/[\u4e00-\u9fff]/.test(JSON.stringify(read(code))), `${code}: Chinese left over`).toBe(false);
    }
  });
});
