import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import {
  shouldTranslateText,
  collectTextBlocks,
  insertDualSpan,
  removeAllTranslations,
  TRANSLATED_ATTR,
} from "../../src/shared/dualSpan.mjs";

function makeDoc(html) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

describe("shouldTranslateText", () => {
  it("accepts normal prose in any language", () => {
    expect(shouldTranslateText("Hola mundo")).toBe(true);
    expect(shouldTranslateText("¡Hola, señor!")).toBe(true);
    expect(shouldTranslateText("你好，世界")).toBe(true);
  });
  it("rejects blank, numeric-only and emoji-only strings", () => {
    expect(shouldTranslateText("")).toBe(false);
    expect(shouldTranslateText("   \n  ")).toBe(false);
    expect(shouldTranslateText("123 456 78.90")).toBe(false);
    expect(shouldTranslateText("😀🎉")).toBe(false);
    expect(shouldTranslateText("a")).toBe(false);
  });
});

describe("collectTextBlocks", () => {
  it("collects paragraph and list blocks in document order", () => {
    const doc = makeDoc(`<p>Hola mundo</p><p>1234</p><ul><li>Item uno</li><li>42</li></ul>`);
    const blocks = collectTextBlocks(doc);
    expect(blocks.map((b) => b.text)).toEqual(["Hola mundo", "Item uno"]);
    expect(blocks[0].el.tagName).toBe("P");
    expect(blocks[1].el.tagName).toBe("LI");
  });
  it("skips pre/code/script/style and already-translated blocks", () => {
    const doc = makeDoc(
      `<p>Hola mundo</p><pre><code>const x = 1;</code></pre>` +
        `<script>var x = "hola";</script><style>.a{color:red}</style>` +
        `<p ${TRANSLATED_ATTR}="1">already done</p>` +
        `<div class="dt-translation">previous translation</div>`
    );
    const blocks = collectTextBlocks(doc);
    expect(blocks.map((b) => b.text)).toEqual(["Hola mundo"]);
  });
  it("does not double-collect nested candidate blocks", () => {
    const doc = makeDoc(`<div><p>Inner para</p></div>`);
    const blocks = collectTextBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].el.tagName).toBe("P");
  });
  it("does not collect a paragraph whose only child candidates are already collected individually", () => {
    const doc = makeDoc(`<p>First</p><p>Second</p>`);
    expect(collectTextBlocks(doc)).toHaveLength(2);
  });
});

describe("insertDualSpan", () => {
  it("inserts a translation block right after the original and marks it", () => {
    const doc = makeDoc(`<p>Hola mundo</p>`);
    const p = doc.querySelector("p");
    const ok = insertDualSpan(doc, p, "Hello world");
    expect(ok).toBe(true);
    expect(p.getAttribute(TRANSLATED_ATTR)).toBe("1");
    const t = p.nextElementSibling;
    expect(t.className).toBe("dt-translation");
    expect(t.textContent).toBe("Hello world");
  });
  it("is idempotent for the same block", () => {
    const doc = makeDoc(`<p>Hola mundo</p>`);
    const p = doc.querySelector("p");
    insertDualSpan(doc, p, "Hello world");
    const second = insertDualSpan(doc, p, "Hello world again");
    expect(second).toBe(false);
    expect(doc.querySelectorAll(".dt-translation")).toHaveLength(1);
  });
});

describe("removeAllTranslations", () => {
  it("removes all translation blocks and resets the marks", () => {
    const doc = makeDoc(`<p>Hola mundo</p><p>Otra frase</p>`);
    const [a, b] = collectTextBlocks(doc);
    insertDualSpan(doc, a.el, "Hello world");
    insertDualSpan(doc, b.el, "Another sentence");
    const removed = removeAllTranslations(doc);
    expect(removed).toBe(2);
    expect(doc.querySelectorAll(".dt-translation")).toHaveLength(0);
    expect(doc.querySelectorAll(`[${TRANSLATED_ATTR}]`)).toHaveLength(0);
  });
});
