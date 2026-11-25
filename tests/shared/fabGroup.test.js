import { describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";
import { mountFabGroup } from "../../src/shared/fabGroup.mjs";

function makeDoc() {
  return new JSDOM(`<!doctype html><html><body><p>Hola mundo</p></body></html>`).window.document;
}

const t = (key) =>
  ({
    btnOriginal: "原文",
    btnTranslating: "翻译中…",
  })[key] || key;

function mount(doc, handlers = {}) {
  const onTranslate = handlers.onTranslate || vi.fn();
  const onOriginal = handlers.onOriginal || vi.fn();
  const group = mountFabGroup(doc, { t, onTranslate, onOriginal });
  return { group, onTranslate, onOriginal };
}

describe("mountFabGroup", () => {
  it("renders the three engine buttons in order", () => {
    const doc = makeDoc();
    mount(doc);
    const labels = [...doc.querySelectorAll(".dt-fab-btn")].map((b) => b.textContent);
    expect(labels).toEqual(["原文", "Google", "AI"]);
  });

  it("marks the Original button active before any translation", () => {
    const doc = makeDoc();
    mount(doc);
    expect(doc.querySelector('[data-engine="original"]').classList.contains("active")).toBe(true);
  });

  it("asks for a Google translation when Google is clicked", () => {
    const doc = makeDoc();
    const { onTranslate } = mount(doc);
    doc.querySelector('[data-engine="google"]').dispatchEvent(new doc.defaultView.Event("click"));
    expect(onTranslate).toHaveBeenCalledWith("google");
  });

  it("asks for an AI translation when AI is clicked", () => {
    const doc = makeDoc();
    const { onTranslate } = mount(doc);
    doc.querySelector('[data-engine="ai"]').dispatchEvent(new doc.defaultView.Event("click"));
    expect(onTranslate).toHaveBeenCalledWith("ai");
  });

  it("calls the original handler without a translation", () => {
    const doc = makeDoc();
    const { onOriginal } = mount(doc);
    doc.querySelector('[data-engine="original"]').dispatchEvent(new doc.defaultView.Event("click"));
    expect(onOriginal).toHaveBeenCalledOnce();
  });

  it("highlights the engine that is translating and disables the rest", () => {
    const doc = makeDoc();
    const { group } = mount(doc);
    group.setBusy("ai");
    expect(doc.querySelector('[data-engine="ai"]').classList.contains("active")).toBe(true);
    expect(doc.querySelector('[data-engine="ai"]').textContent).toBe("翻译中…");
    const buttons = [...doc.querySelectorAll(".dt-fab-btn")];
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it("shows a readable error with the raw detail in the tooltip", () => {
    const doc = makeDoc();
    const { group } = mount(doc);
    group.setBusy("ai");
    group.setError("翻译错误：HTTP 401 Unauthorized", "HTTP 401 Unauthorized — check your API key");
    const error = doc.querySelector(".dt-fab-error");
    expect(error).not.toBeNull();
    expect(error.textContent).toBe("翻译错误：HTTP 401 Unauthorized");
    expect(error.getAttribute("title")).toContain("check your API key");
    const buttons = [...doc.querySelectorAll(".dt-fab-btn")];
    expect(buttons.every((b) => !b.disabled)).toBe(true);
  });

  it("clears the error when a new translation starts", () => {
    const doc = makeDoc();
    const { group } = mount(doc);
    group.setError("boom", "");
    group.setBusy("google");
    expect(doc.querySelector(".dt-fab-error")).toBeNull();
  });

  it("is idempotent — mounting twice keeps a single group", () => {
    const doc = makeDoc();
    mount(doc);
    mount(doc);
    expect(doc.querySelectorAll(".dt-fab-group").length).toBe(1);
    expect(doc.querySelectorAll(".dt-fab-btn").length).toBe(3);
  });
});
