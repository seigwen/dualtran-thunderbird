/**
 * Dual-span injection primitives shared by the Thunderbird content scripts.
 *
 * Pure DOM logic only - no extension APIs - so it runs unchanged in tests
 * (jsdom) and in the mail extension content-script scope via the
 * window.__dtDualSpan global built from this module.
 */

export const TRANSLATED_ATTR = "data-dt-translated";

const CANDIDATE_TAGS = ["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "TD", "BLOCKQUOTE"];
const CANDIDATE_SELECTOR = CANDIDATE_TAGS.join(",");
const SKIP_SELECTOR = ".dt-translation, pre, code, script, style, noscript, textarea";

/** True when a text block carries prose worth translating. */
export function shouldTranslateText(text) {
  const t = (text || "").trim();
  if (t.length < 2) return false;
  if (!/\p{L}/u.test(t)) return false; // needs at least one letter
  if (!/[^\d\s\p{P}\p{S}]/u.test(t)) return false; // not only digits/punctuation/symbols
  return true;
}

/**
 * Collect translatable blocks in document order.
 *
 * Conservative by design: only leaf candidate elements (no nested candidate
 * children), never inside skipped or already-translated subtrees.
 */
export function collectTextBlocks(root) {
  const out = [];
  for (const el of root.querySelectorAll(CANDIDATE_SELECTOR)) {
    if (el.getAttribute(TRANSLATED_ATTR)) continue;
    if (el.closest(SKIP_SELECTOR)) continue;
    if (el.querySelector(CANDIDATE_SELECTOR)) continue; // container of nested candidates
    const text = el.textContent || "";
    if (!shouldTranslateText(text)) continue;
    out.push({ el, text: text.trim() });
  }
  return out;
}

/** Insert the translation block right after the original. Returns false if already done. */
export function insertDualSpan(doc, el, translated) {
  if (!el || el.getAttribute(TRANSLATED_ATTR)) return false;
  const block = doc.createElement("div");
  block.className = "dt-translation";
  block.setAttribute("dir", "auto");
  block.textContent = translated;
  el.setAttribute(TRANSLATED_ATTR, "1");
  el.insertAdjacentElement("afterend", block);
  return true;
}

/** Remove every translation block and reset the marks. Returns the removed count. */
export function removeAllTranslations(root) {
  const blocks = root.querySelectorAll(".dt-translation");
  blocks.forEach((b) => b.remove());
  root.querySelectorAll(`[${TRANSLATED_ATTR}]`).forEach((el) => el.removeAttribute(TRANSLATED_ATTR));
  return blocks.length;
}
