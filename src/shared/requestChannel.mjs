/**
 * Storage-based request channel.
 *
 * `runtime.sendMessage` cannot wake an installed MV3 event page reliably in
 * Thunderbird 160: the message either reaches a stopped page or comes back as
 * "Receiving end does not exist". `storage.onChanged` *is* a persisted wake
 * event, so the content script drops a request into `storage.local.dtRequest`
 * and waits for the background to publish `storage.local.dtResponse`.
 *
 * The listener is attached before the request is written, otherwise a very fast
 * reply would be missed.
 */

const REQUEST_KEY = "dtRequest";
const RESPONSE_KEY = "dtResponse";

/**
 * How long the content script waits for `dtResponse`.
 *
 * Measured on the Thunderbird host: a 24-block AI translation took ~200 s, and
 * a 4-block one exceeded 300 s on a slow day. The previous 120 s budget expired
 * while the background was still working, so the reply arrived with nobody
 * listening - the UI showed neither a translation nor an error. Keep this well
 * above the observed worst case; a timeout here is a fallback, not a deadline.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 600000;

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {{ storage: any }} browser  the WebExtension namespace
 * @param {object} payload            message fields (command, texts, engine…)
 * @param {number} timeoutMs
 * @returns {Promise<object>} the background's reply (same shape as sendMessage)
 */
export function requestViaStorage(browser, payload, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  // Environments without storage events (older hosts, unit-test stubs) keep the
  // old path; the storage channel exists because a stopped event page in
  // Thunderbird does not receive sendMessage at all.
  if (!browser.storage || !browser.storage.onChanged || !browser.storage.local) {
    return browser.runtime.sendMessage(payload);
  }
  const id = newId();
  return new Promise((resolve, reject) => {
    let timer = null;
    const onChange = (changes, area) => {
      if (area !== "local" || !changes[RESPONSE_KEY]) return;
      const value = changes[RESPONSE_KEY].newValue;
      if (!value || value.id !== id) return;
      browser.storage.onChanged.removeListener(onChange);
      if (timer) clearTimeout(timer);
      const { id: _drop, ...reply } = value;
      resolve(reply);
    };
    browser.storage.onChanged.addListener(onChange);
    timer = setTimeout(() => {
      browser.storage.onChanged.removeListener(onChange);
      reject(new Error("Translation request timed out"));
    }, timeoutMs);
    Promise.resolve(browser.storage.local.set({ [REQUEST_KEY]: { id, ...payload, at: Date.now() } })).catch(
      (error) => {
        browser.storage.onChanged.removeListener(onChange);
        if (timer) clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export const REQUEST_STORAGE_KEY = REQUEST_KEY;
export const RESPONSE_STORAGE_KEY = RESPONSE_KEY;
