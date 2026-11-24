/**
 * Reading pane: a floating engine group (Original | Google | AI) that injects
 * a bilingual (dual-span) view - the original stays untouched, the translation
 * appears right below each block.
 *
 * The group replaced the single toggle so the user picks the engine per action
 * instead of hunting through settings. Colours and hit areas mirror the browser
 * extension's floating group; the error path shows a classified reason (HTTP
 * code, network failure, missing key) instead of a bare `null`.
 *
 * Runs alongside build/shared/dualSpan.js, which exposes window.__dtDualSpan.
 */
import { collectTextBlocks, insertDualSpan, removeAllTranslations } from "../shared/dualSpan.mjs";
import { applyGroupProviderState, readSettings } from "../shared/providerGuard.mjs";
import { mountFabGroup } from "../shared/fabGroup.mjs";
import { requestViaStorage } from "../shared/requestChannel.mjs";

(() => {
  const t = (key) => browser.i18n.getMessage(key) || key;

  let busy = false;
  /** SPEC 2.1: stored settings, re-read whenever the group (re)mounts. */
  let settings = null;
  let group = null;

  // Styles for the injected translations. The group carries its own stylesheet
  // in fabGroup.mjs; the MV3 scripting.messageDisplay registration has no CSS
  // channel, so everything is injected from here.
  const style = document.createElement("style");
  style.textContent =
    ".dt-translation{margin:2px 0 10px;padding:2px 0 2px 10px;border-left:3px solid rgba(64,128,200,.65);white-space:pre-wrap}" +
    ".dt-translation::before{content:'DualTran';display:block;font-size:10px;letter-spacing:.04em;color:rgba(64,128,200,.9)}" +
    "@media (prefers-color-scheme:dark){.dt-translation{border-left-color:rgba(130,170,230,.6)}}";
  (document.head || document.documentElement).appendChild(style);

  const report = (note) => {
    try {
      browser.runtime.sendMessage({ command: "dt-diag", note }).catch(() => {});
    } catch (_) {
      /* background gone during shutdown */
    }
  };

  function mount() {
    const existing = document.getElementById("dt-fab-group");
    if (existing && group) return false;
    // A previous content script (reloaded/reinstalled add-on) can leave its
    // group behind after its extension context died. Keeping that DOM would
    // leave `group` null forever and every click would silently return, so
    // drop the orphan and mount a live one.
    if (existing) existing.remove();
    group = mountFabGroup(document, {
      t,
      onOriginal: showOriginal,
      onTranslate: (engine) => translate(engine),
      // The width/position the reader picked last time.
      storage: browser.storage && browser.storage.local,
    });
    // SPEC 2.1: with no AI provider the AI button is off and says why. Settings
    // are read after mounting, so the button never has to guess.
    refreshProviderState();
    return true;
  }

  async function refreshProviderState() {
    if (!group) return;
    settings = await readSettings(browser);
    if (busy) return;
    applyGroupProviderState(group, settings, t);
  }

  function showOriginal() {
    if (busy) return;
    removeAllTranslations(document);
    group.setIdle("original");
  }

  async function translate(engine) {
    if (busy) return;
    // Recover from a dead instance (see mount): a click must never be a no-op.
    if (!group) mount();
    if (!group) return;
    // Clear the previous engine's output *before* collecting: the collector
    // skips nodes marked data-dt-translated, so "Google then AI" used to see
    // an empty block list and do nothing at all.
    if (document.querySelectorAll(".dt-translation").length > 0) removeAllTranslations(document);
    const blocks = collectTextBlocks(document);
    if (blocks.length === 0) {
      // Staying silent here reads as "the button is broken"; say what happened.
      group.setError(t("errorNoTranslatableText"), "");
      return;
    }
    busy = true;
    group.setBusy(engine);
    try {
      const result = await requestViaStorage(browser, {
        command: "dt-translate",
        texts: blocks.map((block) => block.text),
        engine,
      });
      if (!result || result.error) {
        group.setError(
          (result && result.error) || t("errorAiNoResponse"),
          (result && result.errorDetail) || ""
        );
        return;
      }
      let inserted = 0;
      blocks.forEach((block, index) => {
        if (result.translations[index]) {
          if (insertDualSpan(document, block.el, result.translations[index])) inserted += 1;
        }
      });
      // A reply that produced nothing on the page is not a success: reporting it
      // as idle leaves the reader staring at untranslated text with no reason.
      if (inserted === 0) {
        group.setError(t("errorNoTranslatableText"), "");
        return;
      }
      group.setIdle(result.engine === "ai" ? "ai" : "google");
      report(`translated ${inserted} block(s) via ${result.engine}`);
    } catch (error) {
      const message = (error && error.message) || String(error);
      group.setError(message, message);
    } finally {
      busy = false;
      // Not a plain enable: the AI engine may still have no provider, and that
      // button must stay shut (and keep its tooltip).
      if (settings) applyGroupProviderState(group, settings, t);
    }
  }

  // Message documents can be replaced while the message is still loading
  // right after injection; keep remounting briefly so the group survives.
  if (mount()) report("fab mounted");
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (mount()) report("fab mounted after DOMContentLoaded");
    });
  }
  let remounts = 0;
  const remountTimer = setInterval(() => {
    remounts += 1;
    if (mount()) report("fab remounted");
    // A remount (new message document) re-reads the settings and re-enables
    // the AI button as soon as the user has picked a provider - no reload.
    else refreshProviderState();
    if (remounts >= 30) clearInterval(remountTimer);
  }, 1000);

  // Smoke build (DT_SMOKE=1): auto-trigger the translation once the message
  // settles, so the smoke does not depend on synthetic mouse clicks.
  const smoke = typeof __DT_SMOKE__ !== "undefined" && __DT_SMOKE__;
  if (smoke && !document.documentElement.hasAttribute("data-dt-smoke-auto")) {
    document.documentElement.setAttribute("data-dt-smoke-auto", "1");
    setTimeout(() => {
      report(`smoke auto-trigger, group=${!!group}`);
      if (group && !busy) translate((settings && settings.engine) || "google");
    }, 6000);
  }
})();
