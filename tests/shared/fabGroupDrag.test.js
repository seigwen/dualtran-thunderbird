import { describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";
import { mountFabGroup } from "../../src/shared/fabGroup.mjs";

function makeDoc() {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`);
  return dom.window.document;
}

const t = (key) => ({ btnOriginal: "原文", btnTranslating: "翻译中…" }[key] || key);
const noop = () => {};

/** jsdom has no PointerEvent; plain events with the extra fields are enough. */
function pointer(el, type, { x, y, button = 0, pointerId = 1 } = {}) {
  const event = new el.ownerDocument.defaultView.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, button, pointerId });
  el.dispatchEvent(event);
}

describe("fabGroup drag and resize", () => {
  it("exposes a drag handle and a resize handle", () => {
    const doc = makeDoc();
    const group = mountFabGroup(doc, { t, onTranslate: noop, onOriginal: noop });
    expect(group.root.querySelector(".dt-fab-drag")).toBeTruthy();
    expect(group.root.querySelector(".dt-fab-resize")).toBeTruthy();
  });

  it("moves the group when the drag handle is pulled", () => {
    const doc = makeDoc();
    const group = mountFabGroup(doc, { t, onTranslate: noop, onOriginal: noop });
    const handle = group.root.querySelector(".dt-fab-drag");

    // default offset is 18px from the right/bottom edge
    expect(group.root.style.right).toBe("18px");
    expect(group.root.style.bottom).toBe("18px");

    pointer(handle, "pointerdown", { x: 500, y: 500 });
    pointer(handle, "pointermove", { x: 400, y: 450 });
    pointer(handle, "pointerup", { x: 400, y: 450 });

    // dragged 100px left and 50px up → further from the edges
    expect(group.root.style.right).toBe("118px");
    expect(group.root.style.bottom).toBe("68px");
  });

  it("widens the group when the resize handle is pulled left", () => {
    const doc = makeDoc();
    const group = mountFabGroup(doc, { t, onTranslate: noop, onOriginal: noop });
    const handle = group.root.querySelector(".dt-fab-resize");

    pointer(handle, "pointerdown", { x: 900, y: 400 });
    pointer(handle, "pointermove", { x: 800, y: 400 });
    pointer(handle, "pointerup", { x: 800, y: 400 });

    // 100px to the left → 92 + 100
    expect(group.root.style.width).toBe("192px");
  });

  it("clamps the width to a usable range", () => {
    const doc = makeDoc();
    const group = mountFabGroup(doc, { t, onTranslate: noop, onOriginal: noop });
    const handle = group.root.querySelector(".dt-fab-resize");

    pointer(handle, "pointerdown", { x: 900, y: 400 });
    pointer(handle, "pointermove", { x: 2000, y: 400 }); // far right → shrink below min
    expect(parseFloat(group.root.style.width)).toBeGreaterThanOrEqual(48);

    pointer(handle, "pointermove", { x: -2000, y: 400 }); // far left → grow past max
    expect(parseFloat(group.root.style.width)).toBeLessThanOrEqual(240);
    pointer(handle, "pointerup", { x: 400, y: 400 });
  });

  it("persists width and position after a gesture", () => {
    const doc = makeDoc();
    const set = vi.fn(async () => {});
    const get = vi.fn(async () => ({}));
    const group = mountFabGroup(doc, {
      t,
      onTranslate: noop,
      onOriginal: noop,
      storage: { get, set },
    });
    const handle = group.root.querySelector(".dt-fab-resize");
    pointer(handle, "pointerdown", { x: 900, y: 400 });
    pointer(handle, "pointermove", { x: 850, y: 400 });
    pointer(handle, "pointerup", { x: 850, y: 400 });

    expect(set).toHaveBeenCalled();
    const payload = set.mock.calls.at(-1)[0];
    expect(payload.dtFabLayout).toBeTruthy();
    expect(payload.dtFabLayout.width).toBe(142);
  });

  it("restores a stored layout on mount", async () => {
    const doc = makeDoc();
    const storage = {
      get: async () => ({ dtFabLayout: { width: 160, right: 60, bottom: 90 } }),
      set: async () => {},
    };
    const group = mountFabGroup(doc, { t, onTranslate: noop, onOriginal: noop, storage });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(group.root.style.width).toBe("160px");
    expect(group.root.style.right).toBe("60px");
    expect(group.root.style.bottom).toBe("90px");
  });

  it("keeps dragging from fighting the buttons", () => {
    const doc = makeDoc();
    const onTranslate = vi.fn();
    const group = mountFabGroup(doc, { t, onTranslate, onOriginal: noop });
    const handle = group.root.querySelector(".dt-fab-drag");
    pointer(handle, "pointerdown", { x: 500, y: 500 });
    pointer(handle, "pointermove", { x: 480, y: 500 });
    pointer(handle, "pointerup", { x: 480, y: 500 });
    // a drag gesture must not be read as a click on an engine button
    expect(onTranslate).not.toHaveBeenCalled();
  });
});
