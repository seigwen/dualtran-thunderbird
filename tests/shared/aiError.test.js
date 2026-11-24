import { describe, it, expect } from "vitest";
import { describeAiError } from "../../src/shared/aiError.mjs";

/**
 * SPEC — every failure the reading-pane button can hit must map to an i18n key
 * plus a technical detail string. The detail stays English (HTTP codes and
 * provider messages are diagnostics, not prose); the key carries the localized
 * wrapper so the catalogue owns the sentence.
 */
describe("describeAiError", () => {
  it("maps a 401 to the unauthorized message with an API-key hint", () => {
    const result = describeAiError({ statusCode: 401, responseBody: { error: { message: "Unauthorized" } } });
    expect(result.key).toBe("errorTranslationWithMessage");
    expect(result.detail).toContain("HTTP 401");
    expect(result.detail.toLowerCase()).toContain("api key");
  });

  it("maps a 403 to forbidden without the key hint", () => {
    const result = describeAiError({ status: 403 });
    expect(result.key).toBe("errorTranslationWithMessage");
    expect(result.detail).toContain("HTTP 403");
    expect(result.detail.toLowerCase()).not.toContain("api key");
  });

  it("maps a 404 to a model-name hint", () => {
    const result = describeAiError({ statusCode: 404 });
    expect(result.detail).toContain("HTTP 404");
    expect(result.detail.toLowerCase()).toContain("model");
  });

  it("maps a 429 to a retry hint", () => {
    const result = describeAiError({ statusCode: 429 });
    expect(result.detail).toContain("HTTP 429");
    expect(result.detail.toLowerCase()).toContain("retry");
  });

  it("maps any 5xx to a provider-outage message", () => {
    const result = describeAiError({ statusCode: 503 });
    expect(result.detail).toContain("HTTP 503");
    expect(result.detail.toLowerCase()).toContain("provider");
  });

  it("recognises a network failure", () => {
    const result = describeAiError(new TypeError("fetch failed"));
    expect(result.key).toBe("errorTranslationWithMessage");
    expect(result.detail.toLowerCase()).toContain("network");
  });

  it("recognises an aborted request as a timeout", () => {
    const result = describeAiError({ name: "AbortError", message: "The operation was aborted" });
    expect(result.key).toBe("errorTranslationTimeout");
  });

  it("treats a null/empty error as a provider that returned nothing", () => {
    expect(describeAiError(null).key).toBe("errorAiNoResponse");
    expect(describeAiError(undefined).key).toBe("errorAiNoResponse");
    expect(describeAiError({}).key).toBe("errorAiNoResponse");
  });

  it("surfaces an unrecognised provider message verbatim", () => {
    const result = describeAiError({ message: "model is overloaded" });
    expect(result.key).toBe("errorTranslationWithMessage");
    expect(result.detail).toContain("model is overloaded");
  });

  it("falls back to the unknown message when nothing usable is present", () => {
    const result = describeAiError("boom");
    expect(result.key).toBe("errorTranslationWithMessage");
    expect(result.detail).toContain("boom");
  });

  it("treats null-ish placeholders as a provider that said nothing", () => {
    // The AI SDK reports some failures as `{message: "null"}` (a stringified
    // null), which used to reach the user verbatim as "Translation failed: null".
    for (const err of ["null", "undefined", { message: "null" }, { message: "undefined" }, { message: "[object Object]" }]) {
      expect(describeAiError(err).key, JSON.stringify(err)).toBe("errorAiNoResponse");
      expect(describeAiError(err).detail, JSON.stringify(err)).toBe("");
    }
  });

  it("keeps an HTTP status even when the provider message is null-ish", () => {
    const result = describeAiError({ statusCode: 401, message: "null" });
    expect(result.detail).toContain("HTTP 401");
    expect(result.detail.toLowerCase()).toContain("api key");
  });
});
