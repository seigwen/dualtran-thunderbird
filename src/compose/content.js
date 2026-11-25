/**
 * Compose windows: the same floating engine group (Original | Google | AI)
 * translates the message being written. The compose script has full DOM access
 * to the editor (even for plaintext messages it is an HTML document), so the
 * shared dual-span helpers work unchanged.
 *
 * Kept in lockstep with messageDisplay/content.js: same group, same error
 * classification, same SPEC 2.1 provider guard.
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

  // The compose script itself is registered from the shared helper file, so
  // styles for the injected translations are added here (compose windows have
  // no CSS registration). The group carries its own stylesheet.
  const style = document.createElement("style");
  // Match the browser extension's newLine rendering: plain text in the engine's
  // colour, no border, no label. Only a vertical gap separates it from the
  // original. Colours come from settings via CSS variables, so an Options change
  // applies on the next mount without a rebuild.
  style.textContent =
    ".dt-translation{margin:2px 0 8px;padding:0;white-space:pre-wrap;color:var(--dt-google-color,#1d4ed8)}" +
    ".dt-translation[data-engine='ai']{color:var(--dt-ai-color,#7c3aed)}";
  document.documentElement.appendChild(style);

  function mount() {
    const existing = document.getElementById("dt-fab-group");
    if (existing && group) return;
    // Orphaned group from a dead content script: drop it, or `group` stays null
    // and every click returns silently (see messageDisplay/content.js).
    if (existing) existing.remove();
    group = mountFabGroup(document, {
      t,
      onOriginal: showOriginal,
      onTranslate: (engine) => translate(engine),
      // The width/position the reader picked last time.
      storage: browser.storage && browser.storage.local,
    });
    // SPEC 2.1: AI engine without a provider → the AI button is off and its
    // tooltip is providerRequiredError. No provider is guessed.
    refreshProviderState();
  }

  /** Push the configured text colours into the document's CSS variables. */
  function applyTextColours(sett) {
    if (!sett) return;
    const root = document.documentElement;
    if (sett.translatedColor) root.style.setProperty("--dt-google-color", sett.translatedColor);
    if (sett.aiTranslatedColor) root.style.setProperty("--dt-ai-color", sett.aiTranslatedColor);
  }

  async function refreshProviderState() {
    if (!group) return;
    settings = await readSettings(browser);
    applyTextColours(settings);
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
    // Clear before collecting: marked nodes are skipped by the collector, so
    // switching engines after a success would otherwise do nothing.
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
          if (insertDualSpan(document, block.el, result.translations[index], result.engine)) inserted += 1;
        }
      });
      // A reply that produced nothing on the page is not a success: reporting it
      // as idle leaves the writer staring at untranslated text with no reason.
      if (inserted === 0) {
        group.setError(t("errorNoTranslatableText"), "");
        return;
      }
      group.setIdle(result.engine === "ai" ? "ai" : "google");
    } catch (error) {
      const message = (error && error.message) || String(error);
      group.setError(message, message);
    } finally {
      busy = false;
      // Keep the AI-engine guard: the provider may still be unset.
      if (settings) applyGroupProviderState(group, settings, t);
    }
  }

  mount();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  let remounts = 0;
  const remountTimer = setInterval(() => {
    remounts += 1;
    mount();
    if (!document.getElementById("dt-fab-group")) refreshProviderState();
    if (remounts >= 30) clearInterval(remountTimer);
  }, 1000);
})();
