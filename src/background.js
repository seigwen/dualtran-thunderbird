/**
 * Background wiring: register the message-display and compose scripts, then
 * route translation requests from content scripts to the engine.
 *
 * Everything is dependency-injected (messenger + engine) so the whole flow is
 * unit-tested against mocks - see tests/background.test.js.
 */

import { isProviderChosen, providerRequiredError } from "./engine.js";
import { describeAiError } from "./shared/aiError.mjs";
import { REQUEST_STORAGE_KEY, RESPONSE_STORAGE_KEY } from "./shared/requestChannel.mjs";

/**
 * English source strings for the classifier keys, used when a locale catalogue
 * entry is missing (a fresh checkout, a test without i18n). The catalogue wins
 * whenever it has the key — see `npm run i18n:check`.
 */
const ERROR_FALLBACKS = {
  errorTranslationWithMessage: "Translation error: $ERROR_MESSAGE$",
  errorAiNoResponse: "The AI provider returned no response. Check the API key and model name.",
  errorTranslationTimeout: "Translation request timed out",
  errorApiKeyNotFound: "API key not found!",
};

/**
 * Snapshot a thrown value as JSON-safe data. `JSON.stringify(new Error(...))`
 * is `{}`, and the AI SDK puts the useful parts (status, response body) on
 * non-enumerable or nested fields, so walk them explicitly and cap the blobs.
 */
function serializeError(error) {
  if (error == null) return { kind: String(error) };
  if (typeof error === "string") return { kind: "string", value: error };
  if (typeof error !== "object") return { kind: typeof error, value: String(error) };
  const out = {
    kind: (error.constructor && error.constructor.name) || "Object",
    name: error.name,
    message: error.message,
  };
  if (error.statusCode !== undefined) out.statusCode = error.statusCode;
  if (error.status !== undefined) out.status = error.status;
  for (const key of ["responseBody", "data"]) {
    if (error[key] === undefined) continue;
    try {
      out[key] = JSON.stringify(error[key]).slice(0, 2000);
    } catch (_) {
      out[key] = "<unserializable>";
    }
  }
  if (error.cause) out.cause = serializeError(error.cause);
  return out;
}

/**
 * Keep the last translation failure in `storage.local.dtLastError`. Diagnostics
 * must never break a translation, so every step is best-effort and the caller
 * does not await it.
 */
function recordFailure(messenger, error, failure) {
  try {
    const storage = messenger && messenger.storage && messenger.storage.local;
    if (!storage || typeof storage.set !== "function") return;
    const snapshot = {
      at: new Date().toISOString(),
      message: failure.error,
      detail: failure.errorDetail,
      error: serializeError(error),
    };
    // Stored as a JSON string: IndexedDB's structured clone is opaque to the
    // diagnostic tooling, and a string round-trips exactly as written.
    Promise.resolve(storage.set({ dtLastError: JSON.stringify(snapshot) })).catch(() => {});
  } catch (_) {
    /* diagnostics are best-effort */
  }
}

/** A provider that literally says "null" must never become the banner text. */
const NULLISH_DETAIL = /^(null|undefined|\[object object\])$/i;

/**
 * Turn a thrown value into `{ error, errorDetail }`: a localized sentence for
 * the floating group plus the raw technical detail it keeps in the tooltip.
 *
 * The detail is handed to `i18n.getMessage` as its placeholder argument rather
 * than string-patched afterwards: Thunderbird substitutes the placeholder with
 * the literal "null" when no argument is supplied, which is how a network
 * failure surfaced as `Translation error: null`.
 */
export function localizeTranslationError(error, i18n) {
  const { key, detail } = describeAiError(error);
  const cleanDetail = detail && !NULLISH_DETAIL.test(detail) ? detail : "";
  const effectiveKey = cleanDetail ? key : "errorAiNoResponse";
  const args = cleanDetail ? [cleanDetail] : [];

  let localized = "";
  if (i18n && typeof i18n.getMessage === "function") {
    try {
      localized = i18n.getMessage(effectiveKey, args) || "";
    } catch (_) {
      localized = "";
    }
  }

  const template = localized || ERROR_FALLBACKS[effectiveKey] || ERROR_FALLBACKS.errorAiNoResponse;
  const message =
    cleanDetail && template.includes("$ERROR_MESSAGE$")
      ? template.replace("$ERROR_MESSAGE$", cleanDetail)
      : template;
  return { error: message, errorDetail: cleanDetail };
}

export const DISPLAY_SCRIPTS = ["messageDisplay/content.js"];
export const COMPOSE_SCRIPT = ["compose/content.js"];
export const DISPLAY_SCRIPT_ID = "dualtran-message-display@seigwen.dev";
export const COMPOSE_SCRIPT_ID = "dualtran-compose@seigwen.dev";

/**
 * SPEC 2.1: with no provider chosen the AI engine has nothing to call, so the
 * request stops here with the localized `providerRequiredError`. Returning it
 * as the message result (instead of throwing) means no network request is
 * made and every content script can render one string.
 */
function providerMissing(settings, message) {
  const engineName = message.engine ?? (settings && settings.engine);
  const ai = settings ? settings.ai : undefined;
  return engineName === "ai" && !isProviderChosen(ai && ai.provider);
}

export async function registerBackground({
  messenger,
  engine,
  i18n = null,
  getSettingsFn = null,
  setSettingsFn = null,
  debugFn = () => {},
  tabInjectRetries = 0,
  tabInjectRetryDelayMs = 4000,
}) {

  // Register the message listener BEFORE any awaits: MV3 event pages deliver
  // waking events only to listeners added during startup evaluation.
  messenger.runtime.onMessage.addListener(async (message) => {
    if (!message || typeof message.command !== "string") {
      return undefined;
    }
    if (message.command === "dt-diag") {
      debugFn(`diag: ${message.note}`);
      return { ok: true };
    }
    if (message.command === "dt-save-settings") {
      if (!setSettingsFn) return { error: "settings not writable" };
      try {
        const next = await setSettingsFn(message.patch || {});
        return { ok: true, settings: next };
      } catch (error) {
        return { error: error && error.message ? error.message : String(error) };
      }
    }
    if (message.command === "dt-settings") {
      // SPEC 2.1: the in-mail buttons read the stored settings before they
      // enable themselves. Only what the buttons need — never the API key.
      try {
        const settings = getSettingsFn ? await getSettingsFn() : null;
        return {
          settings: settings
            ? {
                engine: settings.engine,
                targetLang: settings.targetLang,
                ai: { provider: String((settings.ai && settings.ai.provider) || "") },
              }
            : null,
        };
      } catch (error) {
        return { error: error && error.message ? error.message : String(error) };
      }
    }
    if (message.command !== "dt-translate") {
      return undefined;
    }
    return handleTranslateMessage(message);
  });

  /**
   * The single place a translation request is served, shared by the sendMessage
   * listener and the storage channel below.
   */
  async function handleTranslateMessage(message) {
    try {
      const settings = getSettingsFn ? await getSettingsFn() : null;
      if (providerMissing(settings, message)) {
        return { error: providerRequiredError(i18n || messenger.i18n).message };
      }
      const result = await engine.translateBatch(message.texts || [], {
        engine: message.engine ?? (settings && settings.engine),
        targetLang: message.targetLang ?? (settings && settings.targetLang),
        ai: settings ? settings.ai : undefined,
      });
      return { translations: result.translations, engine: result.engine, targetLang: result.targetLang };
    } catch (error) {
      const failure = localizeTranslationError(error, i18n || messenger.i18n);
      recordFailure(messenger, error, failure);
      return failure;
    }
  }

  // Thunderbird 160 does not deliver sendMessage to a stopped event page, so a
  // click used to fail with "Receiving end does not exist". storage.onChanged
  // IS a persisted wake event: the content script writes dtRequest, we answer
  // through dtResponse.
  if (messenger.storage && messenger.storage.onChanged) {
    messenger.storage.onChanged.addListener(async (changes, area) => {
      if (area !== "local" || !changes[REQUEST_STORAGE_KEY]) return;
      const request = changes[REQUEST_STORAGE_KEY].newValue;
      if (!request || !request.id) return;
      let reply;
      try {
        reply = await handleTranslateMessage(request);
      } catch (error) {
        reply = { error: String((error && error.message) || error) };
      }
      try {
        await messenger.storage.local.set({ [RESPONSE_STORAGE_KEY]: { id: request.id, ...reply } });
      } catch (error) {
        debugFn(`response publish failed: ${error}`);
      }
    });
  }

  // MV2 host: the whole `scripting.*` namespace does not exist here, so the
  // legacy registration APIs are used instead. A persistent background page is
  // evaluated exactly once per browser start, so registering here cannot
  // accumulate duplicates.
  try {
    await messenger.messageDisplayScripts.register({
      js: DISPLAY_SCRIPTS.map((file) => ({ file })),
    });
    debugFn("display scripts registered");
  } catch (error) {
    debugFn(`message display script registration: ${error}`);
  }

  // Compose windows: full DOM access to the editor from the compose script.
  try {
    await messenger.composeScripts.register({
      js: COMPOSE_SCRIPT.map((file) => ({ file })),
    });
  } catch (error) {
    debugFn(`compose script registration: ${error}`);
  }

  // Registration only covers documents opened afterwards, so message tabs that
  // already exist at (re)start get an explicit injection. Retried briefly on a
  // cold start, when the background may run before Thunderbird finishes
  // restoring windows.
  // Thunderbird tab types: "mail" (3-pane mail tab) and "messageDisplay"
  // (standalone message window/tab) - see the official hello-world example.
  const scanAndInject = async () => {
    let injected = 0;
    try {
      const tabs = (await messenger.tabs.query({})) || [];
      const messageTabs = tabs.filter((tab) => ["mail", "messageDisplay"].includes(tab.type));
      for (const tab of messageTabs) {
        try {
          if (tab.type === "mail") {
            const displayed = await messenger.messageDisplay.getDisplayedMessages(tab.id);
            if (!displayed || displayed.length !== 1) continue;
          }
          await messenger.tabs.executeScript(tab.id, { file: DISPLAY_SCRIPTS[0] });
          injected += 1;
          debugFn(`injected into ${tab.id}`);
        } catch (error) {
          debugFn(`inject into tab ${tab.id} failed: ${error}`);
        }
      }
    } catch (error) {
      debugFn(`tab scan failed: ${error}`);
    }
    return injected;
  };

  let injectedTotal = await scanAndInject();
  let round = 0;
  while (injectedTotal === 0 && round < tabInjectRetries) {
    round += 1;
    await new Promise((resolve) => setTimeout(resolve, tabInjectRetryDelayMs));
    injectedTotal += await scanAndInject();
  }
  debugFn(`injected into ${injectedTotal} message tab(s)`);

}
