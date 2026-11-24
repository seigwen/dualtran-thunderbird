/**
 * Dual-span injection primitives shared by the Thunderbird content scripts.
 *
 * Pure DOM logic only - no extension APIs - so it runs unchanged in tests
 * (jsdom) and in the mail extension content-script scope via the
 * window.__dtDualSpan global built from this module.
 */

export const TRANSLATED_ATTR = "data-dt-translated";

const CANDIDATE_TAGS = ["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "TD", "BLOCKQUOTE", "PRE"];
const CANDIDATE_SELECTOR = CANDIDATE_TAGS.join(",");
// `#messageHeader` is Thunderbird's reading-pane header (From/To/Subject/Date).
// Its cells are TD elements, so without this the collector sent the header to
// the model and never the body - "translate this mail" produced four header
// lines. A plain-text body is rendered into a single <pre>, which used to be in
// this list too; only <code> inside it must stay untranslated.
const SKIP_SELECTOR = ".dt-translation, #messageHeader, code, script, style, noscript, textarea";

/** True when a text block carries prose worth translating. */
export function shouldTranslateText(text) {
  const t = (text || "").trim();
  if (t.length < 2) return false;
  if (!/\p{L}/u.test(t)) return false; // needs at least one letter
  if (!/[^\d\s\p{P}\p{S}]/u.test(t)) return false; // not only digits/punctuation/symbols
  return true;
}

const HEADER_PREFIX = /^(Subject|From|To|Cc|Bcc|Reply-To|Date|Sender|Return-Path)\s*:/i;

/**
 * True when a block is a reading-pane header line rather than body prose.
 *
 * Measured on this host (DT_PROBE build): the whole message is a single <table>,
 * the header cells are <td> siblings of the body, and Thunderbird gives them no
 * id or class to select on - `#messageHeader` and `.message-header-row` are both
 * absent from the message document. The text shape is therefore the only signal
 * available. Only the FIRST line is tested, so prose that merely mentions a
 * header prefix mid-sentence stays translatable.
 *
 * Trade-off (2026-11-24): a body paragraph that itself *starts* with `Subject:`
 * (or the other prefixes) will be skipped. Accepted because that shape does not
 * occur in real mail; revisit if a report ever shows a dropped paragraph.
 */
export function isReadingPaneHeaderText(text) {
  const first = String(text || "").trim().split(/\r?\n/)[0];
  return HEADER_PREFIX.test(first);
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
    // A <pre> that wraps <code> is a code block, not a plain-text body.
    if (el.tagName === "PRE" && el.querySelector("code")) continue;
    if (el.querySelector(CANDIDATE_SELECTOR)) continue; // container of nested candidates
    const text = el.textContent || "";
    if (!shouldTranslateText(text)) continue;
    if (isReadingPaneHeaderText(text)) continue;
    out.push({ el, text: text.trim() });
  }
  return out;
}

/** Insert the translation block right after the original. Returns false if already done. */
export function insertDualSpan(doc, el, translated, engine = "google") {
  if (!el || el.getAttribute(TRANSLATED_ATTR)) return false;
  const block = doc.createElement("div");
  block.className = "dt-translation";
  // The browser extension paints Google and AI results in different colours
  // (translatedColor vs aiTranslatedColor); the engine tag lets the stylesheet
  // give the reader the same tell.
  block.dataset.engine = engine === "ai" ? "ai" : "google";
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
