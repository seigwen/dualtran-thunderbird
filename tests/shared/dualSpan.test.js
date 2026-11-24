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

describe("collectTextBlocks on a real reading pane", () => {
  // Thunderbird renders the reading pane as a header table followed by the body.
  // A plain-text message body lands in a single <pre>, and the header cells are
  // TD elements - which is exactly how "translate this mail" ended up sending
  // From/To/Date/Subject to the model and nothing else.
  const pane = `
    <div id="messageHeader">
      <table><tbody>
        <tr><th>From</th><td>Hermes Notify &lt;clusiro@gmail.com&gt;</td></tr>
        <tr><th>To</th><td>seigwen@gmail.com</td></tr>
        <tr><th>Subject</th><td>DualTran error-copy verification</td></tr>
        <tr><th>Date</th><td>11/24/2026, 9:57 AM</td></tr>
      </tbody></table>
    </div>
    <div id="messageEditor"><div class="moz-text-plain"><pre>
This is a test message used to verify the DualTran translation button.

Second paragraph: open this mail in the reading pane and click the AI button.
</pre></div></div>
  `;

  it("never sends reading-pane header cells as body text", () => {
    const doc = makeDoc(pane);
    const blocks = collectTextBlocks(doc);
    const texts = blocks.map((b) => b.text);
    expect(texts.join("\n")).not.toContain("Hermes Notify");
    expect(texts.join("\n")).not.toContain("11/24/2026");
    expect(texts.some((t) => /^Subject:/i.test(t))).toBe(false);
  });

  it("collects a plain-text body living in a <pre>", () => {
    const doc = makeDoc(pane);
    const blocks = collectTextBlocks(doc);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((b) => b.text.includes("verify the DualTran translation button"))).toBe(true);
  });

  it("still collects a normal HTML body and skips code blocks", () => {
    const doc = makeDoc(`
      <div id="messageHeader"><table><tr><th>From</th><td>A Person</td></tr></table></div>
      <div id="messageEditor">
        <p>First real paragraph of the newsletter.</p>
        <p>Second real paragraph of the newsletter.</p>
        <pre><code>const x = 1; // not prose to translate</code></pre>
      </div>
    `);
    const texts = collectTextBlocks(doc).map((b) => b.text);
    expect(texts).toContain("First real paragraph of the newsletter.");
    expect(texts).toContain("Second real paragraph of the newsletter.");
    expect(texts.join("\n")).not.toContain("const x = 1");
    expect(texts.join("\n")).not.toContain("A Person");
  });
});

describe("insertDualSpan engine attribution", () => {
  // The browser extension paints Google and AI results in different colours
  // (translatedColor vs aiTranslatedColor). The host needs the same tell, so the
  // injected block carries the engine it came from.
  it("marks the block with the engine that produced it", () => {
    const doc = makeDoc(`<p>Hello world</p>`);
    const el = doc.querySelector("p");
    expect(insertDualSpan(doc, el, "你好，世界", "ai")).toBe(true);
    const block = doc.querySelector(".dt-translation");
    expect(block.dataset.engine).toBe("ai");
  });

  it("defaults to google when no engine is given", () => {
    const doc = makeDoc(`<p>Hello world</p>`);
    const el = doc.querySelector("p");
    insertDualSpan(doc, el, "你好，世界");
    expect(doc.querySelector(".dt-translation").dataset.engine).toBe("google");
  });

  it("keeps the block readable as plain text for both engines", () => {
    const doc = makeDoc(`<p>Hello world</p>`);
    const el = doc.querySelector("p");
    insertDualSpan(doc, el, "你好，世界", "ai");
    const block = doc.querySelector(".dt-translation");
    expect(block.textContent).toBe("你好，世界");
    expect(block.getAttribute("dir")).toBe("auto");
  });
});
