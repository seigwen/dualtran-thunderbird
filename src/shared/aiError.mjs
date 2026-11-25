/**
 * Turn whatever the AI SDK threw into something a user can act on.
 *
 * The reading-pane button used to print `Translation failed: null` because the
 * background collapsed every failure into `String(error)`. This module owns the
 * classification instead: it returns an i18n key for the localized wrapper plus
 * an English technical detail (HTTP codes and provider messages are diagnostics,
 * not prose, so they stay untranslated).
 */

/** Error shapes arrive as SDK errors, plain objects, strings or nothing at all. */
function extractMessage(err) {
  if (typeof err === "string") return normalizeMessage(err);
  if (!err || typeof err !== "object") return "";
  const fromBody = err.responseBody && err.responseBody.error && err.responseBody.error.message;
  const fromData = err.data && err.data.error && err.data.error.message;
  const fromMessage = typeof err.message === "string" ? err.message : "";
  return normalizeMessage(fromBody || fromData || fromMessage || "");
}

/** "null", "undefined" and "[object Object]" are stringified absences, not reasons. */
const NON_MESSAGE = /^(null|undefined|\[object object\])$/i;

function normalizeMessage(raw) {
  const text = String(raw || "").trim();
  return NON_MESSAGE.test(text) ? "" : text;
}

function extractStatus(err) {
  if (!err || typeof err !== "object") return 0;
  const raw = err.statusCode || err.status || (err.response && err.response.status) || 0;
  const status = Number(raw);
  return Number.isFinite(status) ? status : 0;
}

const NETWORK_RE = /fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i;

/**
 * @returns {{ key: string, detail: string }} `key` is a locale catalogue entry,
 *   `detail` is appended by the caller (empty when the key alone says it all).
 */
export function describeAiError(err) {
  const status = extractStatus(err);
  const message = extractMessage(err);

  if (!status && !message && !(err && typeof err === "object" && Object.keys(err).length)) {
    return { key: "errorAiNoResponse", detail: "" };
  }

  // Timeouts first: an aborted request may also carry a generic message.
  if (
    (err && typeof err === "object" && err.name === "AbortError") ||
    /timeout|timed out|aborted/i.test(message) && !status
  ) {
    return { key: "errorTranslationTimeout", detail: "" };
  }

  if (status === 401) {
    return { key: "errorTranslationWithMessage", detail: "HTTP 401 Unauthorized — check your API key" };
  }
  if (status === 403) {
    return { key: "errorTranslationWithMessage", detail: "HTTP 403 Forbidden" };
  }
  if (status === 404) {
    return { key: "errorTranslationWithMessage", detail: "HTTP 404 Not Found — check your model name" };
  }
  if (status === 429) {
    return { key: "errorTranslationWithMessage", detail: "HTTP 429 Too Many Requests — retry later" };
  }
  if (status >= 500) {
    return { key: "errorTranslationWithMessage", detail: `HTTP ${status} — provider error` };
  }
  if (status) {
    return { key: "errorTranslationWithMessage", detail: `HTTP ${status}` };
  }

  if (NETWORK_RE.test(message)) {
    return { key: "errorTranslationWithMessage", detail: `Network error — ${message}` };
  }

  if (!message) {
    return { key: "errorAiNoResponse", detail: "" };
  }

  return { key: "errorTranslationWithMessage", detail: message };
}
