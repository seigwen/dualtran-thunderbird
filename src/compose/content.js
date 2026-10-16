/**
 * Compose windows: the same floating button translates the message being
 * written. The compose script has full DOM access to the editor (even for
 * plaintext messages it is an HTML document), so the shared dual-span helpers
 * work unchanged.
 */
import { collectTextBlocks, insertDualSpan, removeAllTranslations } from "../shared/dualSpan.mjs";

(() => {
  const t = (key, detail) => {
    const msg = browser.i18n.getMessage(key) || key;
    return detail === undefined ? msg : msg.replace("$DETAIL$", detail);
  };

  let busy = false;

  function mount() {
    if (document.getElementById("dt-fab")) return;
    const fab = document.createElement("button");
    fab.id = "dt-fab";
    fab.type = "button";
    fab.className = "dt-fab";
    fab.textContent = t("btnComposeTranslate");
    fab.addEventListener("click", onToggle);
    (document.body || document.documentElement).appendChild(fab);
  }

  async function onToggle() {
    if (busy) return;
    const fab = document.getElementById("dt-fab");
    if (document.querySelectorAll(".dt-translation").length > 0) {
      removeAllTranslations(document);
      fab.textContent = t("btnComposeTranslate");
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
      blocks.forEach((block, index) => {
        if (result.translations[index]) {
          insertDualSpan(document, block.el, result.translations[index]);
        }
      });
      fab.textContent = t("btnShowOriginal");
    } catch (error) {
      fab.textContent = t("errorTranslate", (error && error.message) || String(error));
    } finally {
      busy = false;
      fab.disabled = false;
    }
  }

  mount();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  let remounts = 0;
  const remountTimer = setInterval(() => {
    remounts += 1;
    mount();
    if (remounts >= 30) clearInterval(remountTimer);
  }, 1000);

  // The compose script itself is registered from the shared helper file, so
  // styles are injected here (compose windows have no CSS registration).
  const style = document.createElement("style");
  style.textContent =
    ".dt-fab{position:fixed;right:18px;bottom:18px;z-index:2147483000;padding:6px 14px;border:1px solid rgba(64,128,200,.55);border-radius:16px;background:#f6f9ff;color:#1d4e89;font:13px/1.4 system-ui,sans-serif;cursor:pointer;opacity:.92}" +
    ".dt-translation{margin:2px 0 10px;padding:2px 0 2px 10px;border-left:3px solid rgba(64,128,200,.65);white-space:pre-wrap}";
  document.documentElement.appendChild(style);
})();
