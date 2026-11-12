/**
 * Background wiring: register the message-display and compose scripts, then
 * route translation requests from content scripts to the engine.
 *
 * Everything is dependency-injected (messenger + engine) so the whole flow is
 * unit-tested against mocks - see tests/background.test.js.
 */

import { isProviderChosen, providerRequiredError } from "./engine.js";

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
      return { error: error && error.message ? error.message : String(error) };
    }
  });

  // Reading pane: the MV3 way is scripting.messageDisplay.registerScripts
  // (the legacy messageDisplayScripts.register only exists in MV2 contexts).
  // Styles are injected by the content script itself.
  try {
    await messenger.scripting.messageDisplay.registerScripts([
      { id: DISPLAY_SCRIPT_ID, js: [...DISPLAY_SCRIPTS] },
    ]);
  } catch (error) {
    debugFn(`message display script registration: ${error}`);
  }

  // Compose windows: full DOM access to the editor from the compose script.
  try {
    await messenger.scripting.compose.registerScripts([
      { id: COMPOSE_SCRIPT_ID, js: [...COMPOSE_SCRIPT] },
    ]);
  } catch (error) {
    debugFn(`compose script registration: ${error}`);
  }

  // Inject into message tabs that were already open before (re)start - and
  // retry briefly, because on a cold start the background may wake up before
  // Thunderbird has finished restoring or opening message windows.
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
          await messenger.scripting.executeScript({ target: { tabId: tab.id }, files: [...DISPLAY_SCRIPTS] });
          injected += 1;
          try {
            const probe = await messenger.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => ({
                helper: typeof window.__dtDualSpan,
                fab: !!document.getElementById("dt-fab"),
                ready: document.readyState,
                url: String(location.href).slice(0, 90),
              }),
            });
            const value = Array.isArray(probe) ? probe[0] && probe[0].result : probe;
            debugFn(`probe tab ${tab.id}: ${JSON.stringify(value)}`);
          } catch (error) {
            debugFn(`probe tab ${tab.id} failed: ${error}`);
          }
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
