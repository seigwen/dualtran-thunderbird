/**
 * Reading pane: a floating Translate button that injects a bilingual
 * (dual-span) view - the original stays untouched, the translation appears
 * right below each block. Clicking again removes all translations.
 *
 * Runs alongside build/shared/dualSpan.js, which exposes window.__dtDualSpan.
 */
import { collectTextBlocks, insertDualSpan, removeAllTranslations } from "../shared/dualSpan.mjs";

(() => {
  const t = (key, detail) => {
    const msg = browser.i18n.getMessage(key) || key;
    return detail === undefined ? msg : msg.replace("$DETAIL$", detail);
  };

  let busy = false;

  // Styles are injected here: the MV3 scripting.messageDisplay registration
  // carries no CSS, and the shared helper file must stay side-effect free.
  const style = document.createElement("style");
  style.textContent =
    ".dt-fab{position:fixed;right:18px;bottom:18px;z-index:2147483000;padding:6px 14px;border:1px solid rgba(64,128,200,.55);border-radius:16px;background:#f6f9ff;color:#1d4e89;font:13px/1.4 system-ui,sans-serif;cursor:pointer;opacity:.92;box-shadow:0 1px 4px rgba(0,0,0,.15)}" +
    ".dt-fab:hover{opacity:1}.dt-fab:disabled{cursor:progress;opacity:.7}" +
    ".dt-translation{margin:2px 0 10px;padding:2px 0 2px 10px;border-left:3px solid rgba(64,128,200,.65);white-space:pre-wrap}" +
    ".dt-translation::before{content:'DualTran';display:block;font-size:10px;letter-spacing:.04em;color:rgba(64,128,200,.9)}" +
    "@media (prefers-color-scheme:dark){.dt-fab{background:#22303f;color:#9fc3ee;border-color:rgba(130,170,230,.5)}.dt-translation{border-left-color:rgba(130,170,230,.6)}}";
  (document.head || document.documentElement).appendChild(style);

  const report = (note) => {
    try {
      browser.runtime.sendMessage({ command: "dt-diag", note }).catch(() => {});
    } catch (_) {
      /* background gone during shutdown */
    }
  };

  function mount() {
    if (document.getElementById("dt-fab")) return false;
    const fab = document.createElement("button");
    fab.id = "dt-fab";
    fab.type = "button";
    fab.className = "dt-fab";
    fab.textContent = t("btnTranslate");
    fab.addEventListener("click", onToggle);
    (document.body || document.documentElement).appendChild(fab);
    return true;
  }

  async function onToggle() {
    if (busy) return;
    const fab = document.getElementById("dt-fab");
    if (document.querySelectorAll(".dt-translation").length > 0) {
      removeAllTranslations(document);
      fab.textContent = t("btnTranslate");
      return;
    }
    const blocks = collectTextBlocks(document);
    if (blocks.length === 0) return;
    busy = true;
    fab.disabled = true;
    fab.textContent = t("btnTranslating");
    try {
      const result = await browser.runtime.sendMessage({
        command: "dt-translate",
        texts: blocks.map((block) => block.text),
      });
      if (!result || result.error) {
        fab.textContent = t("errorTranslate", (result && result.error) || "unknown");
        return;
      }
      let inserted = 0;
      blocks.forEach((block, index) => {
        if (result.translations[index]) {
          if (insertDualSpan(document, block.el, result.translations[index])) inserted += 1;
        }
      });
      fab.textContent = t("btnShowOriginal");
      report(`translated ${inserted} block(s) via ${result.engine}`);
    } catch (error) {
      fab.textContent = t("errorTranslate", (error && error.message) || String(error));
    } finally {
      busy = false;
      fab.disabled = false;
    }
  }

  // Message documents can be replaced while the message is still loading
  // right after injection; keep remounting briefly so the button survives.
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
    if (remounts >= 30) clearInterval(remountTimer);
  }, 1000);

  // Smoke build (DT_SMOKE=1): auto-trigger the translation once the message
  // settles, so the smoke does not depend on synthetic mouse clicks.
  if (__DT_SMOKE__ && !document.documentElement.hasAttribute("data-dt-smoke-auto")) {
    document.documentElement.setAttribute("data-dt-smoke-auto", "1");
    setTimeout(() => {
      const fab = document.getElementById("dt-fab");
      report(`smoke auto-trigger, fab=${!!fab}`);
      if (fab && !busy) onToggle();
    }, 6000);
  }
})();
